#!/usr/bin/env node
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ReadResourceResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getAuditLogger, initAudit } from "./audit.js";
import { generateKey, generateTitle } from "./autoconnect.js";
import { DEFAULT_PORT, startServer } from "./server.js";
import { getStorage, retryAutoConnect } from "./storage.js";
import { sleep } from "./validation.js";

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as {
  version: string;
};
const VERSION = packageJson.version;

// MCP Apps UI resource URI
const VIEWER_RESOURCE_URI = "ui://conversation-handoff/viewer.html";

// =============================================================================
// CLI Arguments
// =============================================================================

interface CliArgs {
  serve: boolean;
  port: number;
  help: boolean;
  audit: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    serve: false,
    port: DEFAULT_PORT,
    help: false,
    audit: process.env.HANDOFF_AUDIT === "true" || process.env.HANDOFF_AUDIT === "1",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--serve" || arg === "-s") {
      result.serve = true;
    } else if (arg === "--port" || arg === "-p") {
      const portArg = args[++i];
      if (portArg) {
        const port = Number.parseInt(portArg, 10);
        if (!Number.isNaN(port) && port > 0 && port < 65536) {
          result.port = port;
        } else {
          console.error(`Invalid port: ${portArg}`);
          process.exit(1);
        }
      }
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--audit" || arg === "-a") {
      result.audit = true;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
conversation-handoff-mcp - MCP server for conversation handoff between AI chats/projects

Usage:
  conversation-handoff-mcp [options]

Options:
  --serve, -s     Start as HTTP server (shared mode)
  --port, -p      HTTP server port (default: ${DEFAULT_PORT})
  --audit, -a     Enable audit logging (JSONL to /tmp/conversation-handoff-mcp/)
  --help, -h      Show this help message

Modes:
  MCP Mode (default):
    Runs as an MCP server over stdio. In v0.4.0+, the server is automatically
    started in the background for data sharing between clients.

    {
      "mcpServers": {
        "conversation-handoff": {
          "command": "npx",
          "args": ["conversation-handoff-mcp"]
        }
      }
    }

  HTTP Server Mode (--serve):
    Runs as a shared HTTP server explicitly. Useful for manual server management.

    npx conversation-handoff-mcp --serve

  Standalone Mode:
    To disable auto-server and run in standalone mode:

    {
      "mcpServers": {
        "conversation-handoff": {
          "command": "npx",
          "args": ["conversation-handoff-mcp"],
          "env": {
            "HANDOFF_SERVER": "none"
          }
        }
      }
    }

Environment Variables:
  HANDOFF_SERVER               "none" for standalone, or explicit server URL
  HANDOFF_PORT_RANGE           Port range for auto-discovery (default: 1099-1200)
  HANDOFF_RETRY_COUNT          Auto-reconnect retry count (default: 30)
  HANDOFF_RETRY_INTERVAL       Auto-reconnect interval in ms (default: 10000)
  HANDOFF_SERVER_TTL           Server auto-shutdown after inactivity (default: 24h, 0=disabled)
  HANDOFF_MAX_COUNT            Max handoffs (default: 100)
  HANDOFF_MAX_CONVERSATION_BYTES  Max conversation size (default: 1MB)
  HANDOFF_MAX_SUMMARY_BYTES    Max summary size (default: 10KB)
  HANDOFF_MAX_TITLE_LENGTH     Max title length (default: 200)
  HANDOFF_MAX_KEY_LENGTH       Max key length (default: 100)
  HANDOFF_AUDIT                "true" or "1" to enable audit logging (same as --audit)

Note: Data is stored in memory only. Handoffs are lost when the server stops.
`);
}

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
// MCP Server Setup
// =============================================================================

/**
 * Register all MCP tools
 */
function registerTools(server: McpServer): void {
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
    },
    async (
      { key, title, format: _format, summary, conversation, from_ai, from_project },
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
        let errorText = `❌ Error: ${result.error}`;

        if (result.suggestion) {
          errorText += `\n\n💡 ${result.suggestion}`;
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
            text: `✅ ${result.data?.message}\n\nTo load in another session, use: handoff_load("${actualKey}")`,
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
          content: [{ type: "text", text: `❌ Error: ${result.error}` }],
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
              text: `❌ ${result.error}\n\nUse handoff_list to see available handoffs.`,
            },
          ],
        };
      }

      const handoff = result.data;

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
${handoff.conversation}`,
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
              text: `❌ ${result.error}`,
            },
          ],
        };
      }

      const message = key
        ? `✅ ${result.data?.message}`
        : `✅ ${result.data?.message} (${result.data?.count} items)`;

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
              text: `❌ Error: ${result.error}`,
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
              text: "❌ Cannot restart: running in standalone mode (no HTTP server).",
            },
          ],
        };
      }

      if (!serverUrl) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Cannot restart: no server URL available.",
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
              text: `✅ Server restarted successfully on ${result.serverUrl}\n\nNote: Previous handoff data has been cleared.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: "⚠️ Server was shut down but could not be restarted. Falling back to standalone mode.",
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
              text: `❌ Error: ${result.error}`,
            },
          ],
        };
      }

      let message = `✅ ${result.data.message}`;
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
}

/**
 * Register MCP Apps UI resources
 */
function registerAppUI(server: McpServer): void {
  // Handoff Viewer UI リソース
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

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Initialize audit logger (must be first)
  const audit = await initAudit(args.audit);

  // Server mode
  if (args.serve) {
    audit.logLifecycle({
      event: "startup",
      mode: "http",
      version: VERSION,
      port: args.port,
    });
    await startServer(args.port);
    return;
  }

  // MCP mode
  audit.logLifecycle({
    event: "startup",
    mode: "mcp",
    version: VERSION,
  });

  const server = new McpServer({
    name: "conversation-handoff",
    version: VERSION,
  });

  registerTools(server);
  registerAppUI(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Initialize storage (triggers auto-connect if needed)
  // This ensures the shared server starts immediately on MCP client connection
  await getStorage();

  // Graceful shutdown
  const shutdown = async () => {
    audit.logLifecycle({
      event: "shutdown",
      mode: "mcp",
      uptimeSeconds: Math.round(process.uptime()),
    });
    await audit.shutdown();
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  console.error("Conversation Handoff MCP server running on stdio");
}

main().catch(console.error);
