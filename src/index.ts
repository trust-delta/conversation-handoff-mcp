#!/usr/bin/env node
// =============================================================================
// Entry point: MCP server or HTTP server mode
// =============================================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initAudit } from "./audit.js";
import { parseArgs, printHelp } from "./cli.js";
import { startServer } from "./server.js";
import { getStorage } from "./storage.js";
import { registerAppUI, registerTools } from "./tools.js";

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as {
  version: string;
};
const VERSION = packageJson.version;

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
