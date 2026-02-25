// =============================================================================
// CLI argument parsing and help
// =============================================================================

import { DEFAULT_PORT } from "./server.js";

export interface CliArgs {
  serve: boolean;
  port: number;
  help: boolean;
  audit: boolean;
}

/** Parse command-line arguments into structured options */
export function parseArgs(): CliArgs {
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

/** Print usage help to stdout */
export function printHelp(): void {
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
