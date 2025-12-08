#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateKey, generateTitle } from "./autoconnect.js";
import { DEFAULT_PORT, startServer } from "./server.js";
import { getStorage } from "./storage.js";

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as {
  version: string;
};
const VERSION = packageJson.version;

// =============================================================================
// CLI Arguments
// =============================================================================

interface CliArgs {
  serve: boolean;
  port: number;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    serve: false,
    port: DEFAULT_PORT,
    help: false,
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

Note: Data is stored in memory only. Handoffs are lost when the server stops.
`);
}

// =============================================================================
// MCP Server Setup
// =============================================================================

function registerTools(server: McpServer): void {
  // handoff_save
  server.registerTool(
    "handoff_save",
    {
      description:
        "Save a conversation handoff for later retrieval. Use this to pass conversation context to another AI or project.",
      inputSchema: {
        key: z
          .string()
          .optional()
          .describe(
            "Unique identifier for this handoff (e.g., 'project-design-2024'). Auto-generated if omitted."
          ),
        title: z
          .string()
          .optional()
          .describe(
            "Human-readable title for the handoff. Auto-generated from summary if omitted."
          ),
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
      // Auto-generate key and title if not provided
      const actualKey = key || generateKey();
      const actualTitle = title || generateTitle(summary);

      const { storage } = await getStorage();
      const result = await storage.save({
        key: actualKey,
        title: actualTitle,
        summary,
        conversation,
        from_ai,
        from_project,
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

  // handoff_list
  server.registerTool(
    "handoff_list",
    {
      description:
        "List all saved handoffs with summaries. Returns lightweight metadata without full conversation content.",
    },
    async () => {
      const { storage } = await getStorage();
      const result = await storage.list();

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

      if (!result.data || result.data.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No handoffs saved. Use handoff_save to create one.",
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

  // handoff_load
  server.registerTool(
    "handoff_load",
    {
      description: "Load a specific handoff by key. Returns full conversation content.",
      inputSchema: {
        key: z.string().describe("The key of the handoff to load"),
        max_messages: z
          .number()
          .optional()
          .describe("Optional: limit number of messages to return"),
      },
    },
    async ({ key, max_messages }) => {
      const { storage } = await getStorage();
      const result = await storage.load(key, max_messages);

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
      const { storage } = await getStorage();
      const result = await storage.clear(key);

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
  server.registerTool(
    "handoff_stats",
    {
      description: "Get storage statistics and current limits. Useful for monitoring usage.",
    },
    async () => {
      const { storage } = await getStorage();
      const result = await storage.stats();

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

  // Server mode
  if (args.serve) {
    await startServer(args.port);
    return;
  }

  // MCP mode
  const server = new McpServer({
    name: "conversation-handoff",
    version: VERSION,
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Initialize storage (triggers auto-connect if needed)
  // This ensures the shared server starts immediately on MCP client connection
  await getStorage();

  console.error("Conversation Handoff MCP server running on stdio");
}

main().catch(console.error);
