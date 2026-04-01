// =============================================================================
// MCP tool registration and UI resource setup
// =============================================================================

import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ReadResourceResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getAuditLogger } from "./audit.js";
import { generateKey, generateTitle } from "./autoconnect.js";
import { getStorage, retryAutoConnect } from "./storage.js";
import { sleep } from "./validation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// MCP Apps UI resource URI
const VIEWER_RESOURCE_URI = "ui://conversation-handoff/viewer.html";

// =============================================================================
// Progress Notifications
// =============================================================================

/** Tool handler extra parameter type */
type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Send MCP progress notification if client requested it.
 * No-op if progressToken is not present (client doesn't support/request progress).
 */
async function sendProgress(
  extra: ToolExtra,
  progress: number,
  total: number,
  message: string
): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return;
  try {
    await extra.sendNotification({
      method: "notifications/progress" as const,
      params: { progressToken, progress, total, message },
    });
  } catch {
    // Progress notifications are best-effort; ignore failures
    // (e.g., client disconnect should not break the tool operation)
  }
}

// =============================================================================
// Tool Registration
// =============================================================================

/**
 * Register all MCP tools
 */
export function registerTools(server: McpServer): void {
  // handoff_save
  server.tool(
    "handoff_save",
    `Save a conversation handoff for later retrieval. Use this to pass conversation context to another AI or project.

## Format Selection
- **structured** (default): Organize content using the template below. Much faster — reduces output tokens to ~5-20% of the original conversation. Best for most handoffs.
- **verbatim**: Save the complete word-for-word conversation. Use only when exact wording matters (e.g., legal text, precise error messages).

## Structured Template (for format="structured")
\`\`\`
## Key Decisions
- [Decision]: [Rationale]

## Implementation Details
[What was built/changed, with relevant code snippets]

## Code Changes
[Files modified with brief description]

## Open Issues
- [Issue]: [Status/Context]

## Next Steps
- [ ] Action item
\`\`\`

Omit sections that don't apply. Add custom sections if needed.`,
    {
      key: z
        .string()
        .optional()
        .describe(
          "Unique identifier for this handoff (e.g., 'project-design-2024'). Auto-generated if omitted."
        ),
      title: z
        .string()
        .optional()
        .describe("Human-readable title for the handoff. Auto-generated from summary if omitted."),
      format: z
        .enum(["structured", "verbatim"])
        .default("structured")
        .describe(
          "Output format. 'structured' (default): organized template - faster. 'verbatim': complete word-for-word conversation."
        ),
      summary: z.string().describe("Brief summary of the conversation context (2-3 sentences)"),
      conversation: z
        .string()
        .describe(
          "The conversation content. For format='structured': use the structured template above. For format='verbatim': the COMPLETE verbatim conversation in Markdown format (## User / ## Assistant) — NEVER summarize or shorten messages."
        ),
      from_ai: z
        .string()
        .default("claude")
        .describe("Name of the source AI (e.g., 'claude', 'chatgpt')"),
      from_project: z.string().default("").describe("Name of the source project (optional)"),
      message_count: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Number of messages in the conversation (auto-calculated if omitted)"),
      conversation_bytes: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Byte size of the conversation content (auto-calculated if omitted)"),
      status: z
        .enum(["active", "completed", "pending"])
        .optional()
        .describe("Status of the handoff: 'active' (default), 'completed', or 'pending'"),
      next_action: z
        .string()
        .optional()
        .describe("Suggested next action for the receiver (e.g., 'Run tests and deploy')"),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Tags for categorizing this handoff (e.g., ['project:foo', 'issue:176', 'auth']). Lowercase alphanumeric, hyphens, underscores, colons."
        ),
    },
    async (
      {
        key,
        title,
        format: _format,
        summary,
        conversation,
        from_ai,
        from_project,
        message_count,
        conversation_bytes,
        status,
        next_action,
        tags,
      },
      extra
    ) => {
      const audit = getAuditLogger();
      const timer = audit.startTimer();
      const totalSteps = 3;

      await sendProgress(extra, 1, totalSteps, "Connecting to storage...");

      // Auto-generate key and title if not provided
      const actualKey = key || generateKey();
      const actualTitle = title || generateTitle(summary);

      const { storage } = await getStorage();

      await sendProgress(extra, 2, totalSteps, "Saving handoff...");

      const result = await storage.save({
        key: actualKey,
        title: actualTitle,
        summary,
        conversation,
        from_ai,
        from_project,
        message_count,
        conversation_bytes,
        status,
        next_action,
        tags,
      });

      if (result.success) {
        await sendProgress(extra, 3, totalSteps, "Complete");
      }

      // Use pre-calculated sizes from validation when available (LocalStorage),
      // fall back to recalculation for RemoteStorage
      const inputSizes = result.metadata?.inputSizes ?? {
        conversationBytes: Buffer.byteLength(conversation, "utf-8"),
        summaryBytes: Buffer.byteLength(summary, "utf-8"),
      };

      audit.logTool({
        event: "tool_call",
        toolName: "handoff_save",
        durationMs: timer.elapsed(),
        success: result.success,
        error: result.error,
        inputSizes,
      });

      if (!result.success) {
        // Build error message with suggestion and pending content if available
        let errorText = `\u274C Error: ${result.error}`;

        if (result.suggestion) {
          errorText += `\n\n\uD83D\uDCA1 ${result.suggestion}`;
        }

        if (result.pendingContent) {
          errorText += "\n\n---\n## Pending Handoff Content\n\n";
          errorText += `**Key:** ${result.pendingContent.key}\n`;
          errorText += `**Title:** ${result.pendingContent.title}\n`;
          errorText += `**Summary:** ${result.pendingContent.summary}\n\n`;
          errorText += `### Conversation\n${result.pendingContent.conversation}`;
        }

        return {
          content: [
            {
              type: "text",
              text: errorText,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `\u2705 ${result.data?.message}\n\nTo load in another session, use: handoff_load("${actualKey}")`,
          },
        ],
      };
    }
  );

  // handoff_list (with MCP Apps UI support)
  registerAppTool(
    server,
    "handoff_list",
    {
      title: "Handoff List",
      description:
        "List all saved handoffs with summaries. Returns lightweight metadata without full conversation content. Opens interactive UI if supported.",
      inputSchema: {},
      outputSchema: z.object({
        count: z.number().describe("Number of handoffs"),
        handoffs: z
          .array(
            z.object({
              key: z.string(),
              title: z.string(),
              summary: z.string(),
              from_ai: z.string(),
              from_project: z.string(),
              created_at: z.string(),
              comment_count: z.number(),
              message_count: z.number().optional(),
              conversation_bytes: z.number().optional(),
              status: z.enum(["active", "completed", "pending"]).optional(),
              next_action: z.string().optional(),
              tags: z.array(z.string()).optional(),
            })
          )
          .describe("List of handoffs"),
      }),
      _meta: { ui: { resourceUri: VIEWER_RESOURCE_URI } },
    },
    async (): Promise<CallToolResult> => {
      const audit = getAuditLogger();
      const timer = audit.startTimer();

      const { storage } = await getStorage();
      const result = await storage.list();

      audit.logTool({
        event: "tool_call",
        toolName: "handoff_list",
        durationMs: timer.elapsed(),
        success: result.success,
        error: result.error,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `\u274C Error: ${result.error}` }],
        };
      }

      const handoffs = result.data || [];

      if (handoffs.length === 0) {
        return {
          content: [{ type: "text", text: "No handoffs saved. Use handoff_save to create one." }],
          structuredContent: { count: 0, handoffs: [] },
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(handoffs, null, 2) }],
        structuredContent: { count: handoffs.length, handoffs },
      };
    }
  );

  // handoff_load
  server.tool(
    "handoff_load",
    "Load a specific handoff by key. Returns full conversation content.",
    {
      key: z.string().describe("The key of the handoff to load"),
      max_messages: z.number().optional().describe("Optional: limit number of messages to return"),
    },
    async ({ key, max_messages }) => {
      const audit = getAuditLogger();
      const timer = audit.startTimer();

      const { storage } = await getStorage();
      const result = await storage.load(key, max_messages);

      audit.logTool({
        event: "tool_call",
        toolName: "handoff_load",
        durationMs: timer.elapsed(),
        success: result.success,
        error: result.error,
      });

      if (!result.success || !result.data) {
        return {
          content: [
            {
              type: "text",
              text: `\u274C ${result.error}\n\nUse handoff_list to see available handoffs.`,
            },
          ],
        };
      }

      const handoff = result.data;
      const comments = handoff.comments ?? [];

      let commentsText = "";
      if (comments.length > 0) {
        const commentLines = comments.map(
          (c) => `- **${c.author}** (${c.created_at}): ${c.content}`
        );
        commentsText = `\n\n## Comments (${comments.length})\n${commentLines.join("\n")}`;
      }

      return {
        content: [
          {
            type: "text",
            text: `# Handoff: ${handoff.title}

**From:** ${handoff.from_ai}${handoff.from_project ? ` (${handoff.from_project})` : ""}
**Created:** ${handoff.created_at}

## Summary
${handoff.summary}

## Conversation
${handoff.conversation}${commentsText}`,
          },
        ],
        structuredContent: {
          key: handoff.key,
          title: handoff.title,
          summary: handoff.summary,
          conversation: handoff.conversation,
          from_ai: handoff.from_ai,
          from_project: handoff.from_project,
          created_at: handoff.created_at,
          comments,
        },
      };
    }
  );

  // handoff_clear
  server.tool(
    "handoff_clear",
    "Clear handoffs. If key is provided, clears only that handoff. Otherwise clears all.",
    {
      key: z.string().optional().describe("Optional: specific handoff key to clear"),
    },
    async ({ key }) => {
      const audit = getAuditLogger();
      const timer = audit.startTimer();

      const { storage } = await getStorage();
      const result = await storage.clear(key);

      audit.logTool({
        event: "tool_call",
        toolName: "handoff_clear",
        durationMs: timer.elapsed(),
        success: result.success,
        error: result.error,
      });

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `\u274C ${result.error}`,
            },
          ],
        };
      }

      const message = key
        ? `\u2705 ${result.data?.message}`
        : `\u2705 ${result.data?.message} (${result.data?.count} items)`;

      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    }
  );

  // handoff_stats
  server.tool(
    "handoff_stats",
    "Get storage statistics and current limits. Useful for monitoring usage.",
    {},
    async () => {
      const audit = getAuditLogger();
      const timer = audit.startTimer();

      const { storage } = await getStorage();
      const result = await storage.stats();

      audit.logTool({
        event: "tool_call",
        toolName: "handoff_stats",
        durationMs: timer.elapsed(),
        success: result.success,
        error: result.error,
      });

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `\u274C Error: ${result.error}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    }
  );

  // handoff_restart
  server.tool(
    "handoff_restart",
    "Restart the shared HTTP server. Useful when the server is in an unhealthy state. All stored handoffs will be lost (data is in-memory).",
    {},
    async (_, extra) => {
      const audit = getAuditLogger();
      const timer = audit.startTimer();
      const totalSteps = 3;

      await sendProgress(extra, 1, totalSteps, "Checking server status...");

      const { mode, serverUrl } = await getStorage();

      if (mode === "standalone" || mode === "standalone-explicit") {
        return {
          content: [
            {
              type: "text",
              text: "\u274C Cannot restart: running in standalone mode (no HTTP server).",
            },
          ],
        };
      }

      if (!serverUrl) {
        return {
          content: [
            {
              type: "text",
              text: "\u274C Cannot restart: no server URL available.",
            },
          ],
        };
      }

      await sendProgress(extra, 2, totalSteps, "Shutting down server...");

      // Send shutdown request to the server
      try {
        await fetch(`${serverUrl}/shutdown`, {
          method: "POST",
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        // Connection reset after server exits is expected
      }

      // Wait for server to fully shut down
      await sleep(500);

      await sendProgress(extra, 3, totalSteps, "Starting new server...");

      // Restart via retryAutoConnect (resets cache and starts a new server)
      const result = await retryAutoConnect();

      audit.logTool({
        event: "tool_call",
        toolName: "handoff_restart",
        durationMs: timer.elapsed(),
        success: result.mode === "shared",
      });

      if (result.mode === "shared" && result.serverUrl) {
        return {
          content: [
            {
              type: "text",
              text: `\u2705 Server restarted successfully on ${result.serverUrl}\n\nNote: Previous handoff data has been cleared.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: "\u26A0\uFE0F Server was shut down but could not be restarted. Falling back to standalone mode.",
          },
        ],
      };
    }
  );

  // handoff_merge
  server.tool(
    "handoff_merge",
    "Merge multiple handoffs into one. Combines conversations and metadata from related handoffs into a single unified handoff.",
    {
      keys: z.array(z.string()).min(2).describe("Keys of the handoffs to merge (minimum 2)"),
      new_key: z
        .string()
        .optional()
        .describe("Key for the merged handoff. Auto-generated if omitted."),
      new_title: z
        .string()
        .optional()
        .describe("Title for the merged handoff. Auto-generated if omitted."),
      new_summary: z
        .string()
        .optional()
        .describe(
          "Summary for the merged handoff. Auto-generated from source summaries if omitted."
        ),
      delete_sources: z
        .boolean()
        .default(false)
        .describe("Whether to delete source handoffs after merging"),
      strategy: z
        .enum(["chronological", "sequential"])
        .default("chronological")
        .describe(
          "Merge strategy: 'chronological' sorts by creation time, 'sequential' keeps array order"
        ),
    },
    async ({ keys, new_key, new_title, new_summary, delete_sources, strategy }, extra) => {
      const audit = getAuditLogger();
      const timer = audit.startTimer();
      const totalSteps = 3;

      await sendProgress(extra, 1, totalSteps, "Connecting to storage...");

      const { storage } = await getStorage();

      await sendProgress(extra, 2, totalSteps, `Merging ${keys.length} handoffs...`);

      const result = await storage.merge({
        keys,
        new_key,
        new_title,
        new_summary,
        delete_sources,
        strategy,
      });

      if (result.success) {
        await sendProgress(extra, 3, totalSteps, "Complete");
      }

      audit.logTool({
        event: "tool_call",
        toolName: "handoff_merge",
        durationMs: timer.elapsed(),
        success: result.success,
        error: result.error,
      });

      if (!result.success || !result.data) {
        return {
          content: [
            {
              type: "text",
              text: `\u274C Error: ${result.error}`,
            },
          ],
        };
      }

      let message = `\u2705 ${result.data.message}`;
      if (result.data.deleted_sources) {
        message += "\n\nSource handoffs have been deleted.";
      }
      message += `\n\nTo load the merged handoff, use: handoff_load("${result.data.merged_key}")`;

      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    }
  );

  // handoff_add_comment
  server.tool(
    "handoff_add_comment",
    "Add a comment or annotation to an existing handoff. Comments are included when loading the handoff.",
    {
      key: z.string().describe("The key of the handoff to comment on"),
      content: z.string().describe("The comment content"),
      author: z
        .string()
        .default("anonymous")
        .describe("Author name for the comment (default: 'anonymous')"),
    },
    async ({ key, content, author }) => {
      const audit = getAuditLogger();
      const timer = audit.startTimer();

      const { storage } = await getStorage();
      const result = await storage.addComment(key, author, content);

      audit.logTool({
        event: "tool_call",
        toolName: "handoff_add_comment",
        durationMs: timer.elapsed(),
        success: result.success,
        error: result.error,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `\u274C Error: ${result.error}` }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `\u2705 Comment added to "${key}"\n\n**${result.data?.author}**: ${result.data?.content}`,
          },
        ],
      };
    }
  );

  // handoff_delete_comment
  server.tool(
    "handoff_delete_comment",
    "Delete a comment from a handoff by its comment ID.",
    {
      key: z.string().describe("The key of the handoff"),
      comment_id: z.string().describe("The ID of the comment to delete"),
    },
    async ({ key, comment_id }) => {
      const audit = getAuditLogger();
      const timer = audit.startTimer();

      const { storage } = await getStorage();
      const result = await storage.deleteComment(key, comment_id);

      audit.logTool({
        event: "tool_call",
        toolName: "handoff_delete_comment",
        durationMs: timer.elapsed(),
        success: result.success,
        error: result.error,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `\u274C Error: ${result.error}` }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `\u2705 Comment deleted from "${key}"`,
          },
        ],
      };
    }
  );

  // handoff_search
  server.tool(
    "handoff_search",
    "Search handoffs by tags, text query, project, AI, status, or date range. Returns matching handoff summaries without full conversation content. Use this to discover relevant handoffs in multi-agent workflows.",
    {
      tags: z
        .array(z.string())
        .optional()
        .describe("Find handoffs with ANY of these tags (e.g., ['project:foo', 'auth'])"),
      tags_all: z.array(z.string()).optional().describe("Find handoffs with ALL of these tags"),
      query: z.string().optional().describe("Text search in title and summary (case-insensitive)"),
      from_project: z.string().optional().describe("Filter by exact project name"),
      from_ai: z.string().optional().describe("Filter by exact AI name"),
      status: z.enum(["active", "completed", "pending"]).optional().describe("Filter by status"),
      created_after: z
        .string()
        .optional()
        .describe("ISO date: only handoffs created after this time"),
      created_before: z
        .string()
        .optional()
        .describe("ISO date: only handoffs created before this time"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results to return (default: 20)"),
    },
    async (params) => {
      const audit = getAuditLogger();
      const timer = audit.startTimer();

      const { storage } = await getStorage();
      const result = await storage.search(params);

      audit.logTool({
        event: "tool_call",
        toolName: "handoff_search",
        durationMs: timer.elapsed(),
        success: result.success,
        error: result.error,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `\u274C Error: ${result.error}` }],
        };
      }

      const handoffs = result.data || [];

      if (handoffs.length === 0) {
        return {
          content: [{ type: "text", text: "No handoffs matched your search criteria." }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(handoffs, null, 2) }],
      };
    }
  );
}

/**
 * Register MCP Apps UI resources
 */
export function registerAppUI(server: McpServer): void {
  // Handoff Viewer UI resource
  registerAppResource(
    server,
    VIEWER_RESOURCE_URI,
    VIEWER_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(join(__dirname, "..", "dist", "ui", "viewer.html"), "utf-8");
      return {
        contents: [{ uri: VIEWER_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    }
  );
}
