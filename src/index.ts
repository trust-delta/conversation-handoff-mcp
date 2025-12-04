#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { defaultConfig, formatBytes, validateHandoff } from "./validation.js";

// =============================================================================
// Types
// =============================================================================

interface Handoff {
  key: string;
  title: string;
  from_ai: string;
  from_project: string;
  created_at: string;
  summary: string;
  conversation: string;
}

interface HandoffSummary {
  key: string;
  title: string;
  from_ai: string;
  from_project: string;
  created_at: string;
  summary: string;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

const handoffs = new Map<string, Handoff>();
const config = defaultConfig;

// =============================================================================
// MCP Server Setup
// =============================================================================

const server = new McpServer({
  name: "conversation-handoff",
  version: "0.1.6",
});

// =============================================================================
// Tool Definitions
// =============================================================================

// handoff_save
server.registerTool(
  "handoff_save",
  {
    description:
      "Save a conversation handoff for later retrieval. Use this to pass conversation context to another AI or project.",
    inputSchema: {
      key: z.string().describe("Unique identifier for this handoff (e.g., 'project-design-2024')"),
      title: z.string().describe("Human-readable title for the handoff"),
      summary: z.string().describe("Brief summary of the conversation context"),
      conversation: z
        .string()
        .describe("Full conversation in Markdown format (## User / ## Assistant)"),
      from_ai: z
        .string()
        .default("claude")
        .describe("Name of the source AI (e.g., 'claude', 'chatgpt')"),
      from_project: z.string().default("").describe("Name of the source project (optional)"),
    },
  },
  async ({ key, title, summary, conversation, from_ai, from_project }) => {
    // Validate input
    const validation = validateHandoff(
      key,
      title,
      summary,
      conversation,
      handoffs.size,
      handoffs.has(key),
      config
    );
    if (!validation.valid) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Validation error: ${validation.error}`,
          },
        ],
      };
    }

    const handoff: Handoff = {
      key,
      title,
      from_ai,
      from_project,
      created_at: new Date().toISOString(),
      summary,
      conversation,
    };

    handoffs.set(key, handoff);

    return {
      content: [
        {
          type: "text",
          text: `✅ Handoff saved: "${title}" (key: ${key})\n\nTo load in another session, use: handoff_load("${key}")`,
        },
      ],
    };
  }
);

// handoff_list
server.registerTool(
  "handoff_list",
  {
    description:
      "List all saved handoffs with summaries. Returns lightweight metadata without full conversation content.",
  },
  async () => {
    if (handoffs.size === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No handoffs saved. Use handoff_save to create one.",
          },
        ],
      };
    }

    const summaries: HandoffSummary[] = Array.from(handoffs.values()).map((h) => ({
      key: h.key,
      title: h.title,
      from_ai: h.from_ai,
      from_project: h.from_project,
      created_at: h.created_at,
      summary: h.summary,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(summaries, null, 2),
        },
      ],
    };
  }
);

// handoff_load
server.registerTool(
  "handoff_load",
  {
    description: "Load a specific handoff by key. Returns full conversation content.",
    inputSchema: {
      key: z.string().describe("The key of the handoff to load"),
      max_messages: z.number().optional().describe("Optional: limit number of messages to return"),
    },
  },
  async ({ key, max_messages }) => {
    const handoff = handoffs.get(key);

    if (!handoff) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Handoff not found: "${key}"\n\nUse handoff_list to see available handoffs.`,
          },
        ],
      };
    }

    let conversation = handoff.conversation;

    // Optional: truncate messages
    if (max_messages && max_messages > 0) {
      const messages = conversation.split(/(?=## (?:User|Assistant))/);
      if (messages.length > max_messages) {
        conversation = messages.slice(-max_messages).join("");
        conversation = `[... truncated to last ${max_messages} messages ...]\n\n${conversation}`;
      }
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
${conversation}`,
        },
      ],
    };
  }
);

// handoff_clear
server.registerTool(
  "handoff_clear",
  {
    description:
      "Clear handoffs. If key is provided, clears only that handoff. Otherwise clears all.",
    inputSchema: {
      key: z.string().optional().describe("Optional: specific handoff key to clear"),
    },
  },
  async ({ key }) => {
    if (key) {
      if (handoffs.has(key)) {
        handoffs.delete(key);
        return {
          content: [
            {
              type: "text",
              text: `✅ Handoff cleared: "${key}"`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `❌ Handoff not found: "${key}"`,
          },
        ],
      };
    }
    const count = handoffs.size;
    handoffs.clear();
    return {
      content: [
        {
          type: "text",
          text: `✅ All handoffs cleared (${count} items)`,
        },
      ],
    };
  }
);

// handoff_stats
server.registerTool(
  "handoff_stats",
  {
    description: "Get storage statistics and current limits. Useful for monitoring usage.",
  },
  async () => {
    let totalBytes = 0;
    for (const h of handoffs.values()) {
      totalBytes += Buffer.byteLength(h.conversation, "utf8");
      totalBytes += Buffer.byteLength(h.summary, "utf8");
      totalBytes += Buffer.byteLength(h.title, "utf8");
      totalBytes += Buffer.byteLength(h.key, "utf8");
    }

    const stats = {
      current: {
        handoffs: handoffs.size,
        totalBytes,
        totalBytesFormatted: formatBytes(totalBytes),
      },
      limits: {
        maxHandoffs: config.maxHandoffs,
        maxConversationBytes: config.maxConversationBytes,
        maxSummaryBytes: config.maxSummaryBytes,
        maxTitleLength: config.maxTitleLength,
        maxKeyLength: config.maxKeyLength,
      },
      usage: {
        handoffsPercent: Math.round((handoffs.size / config.maxHandoffs) * 100),
      },
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }
);

// =============================================================================
// Main
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Conversation Handoff MCP server running on stdio");
}

main().catch(console.error);
