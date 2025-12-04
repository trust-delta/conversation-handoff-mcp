import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { LocalStorage, type SaveInput } from "./storage.js";

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_PORT = 1099;

// =============================================================================
// HTTP Server
// =============================================================================

export class HttpServer {
  private storage: LocalStorage;
  private port: number;

  constructor(port: number = DEFAULT_PORT) {
    this.storage = new LocalStorage();
    this.port = port;
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  private parseRoute(url: string): { path: string; key?: string; query: URLSearchParams } {
    const urlObj = new URL(url, `http://localhost:${this.port}`);
    const pathname = urlObj.pathname;

    // Match /handoff/:key pattern
    const handoffMatch = pathname.match(/^\/handoff\/([^/]+)$/);
    if (handoffMatch?.[1]) {
      return {
        path: "/handoff/:key",
        key: decodeURIComponent(handoffMatch[1]),
        query: urlObj.searchParams,
      };
    }

    return { path: pathname, query: urlObj.searchParams };
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method || "GET";
    const { path, key, query } = this.parseRoute(req.url || "/");

    // CORS headers for flexibility
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // POST /handoff - Save handoff
      if (method === "POST" && path === "/handoff") {
        const body = await this.readBody(req);
        const input = JSON.parse(body) as SaveInput;

        const result = await this.storage.save(input);
        if (result.success) {
          this.sendJson(res, 200, result.data);
        } else {
          this.sendJson(res, 400, { error: result.error });
        }
        return;
      }

      // GET /handoff - List handoffs
      if (method === "GET" && path === "/handoff") {
        const result = await this.storage.list();
        if (result.success) {
          this.sendJson(res, 200, result.data);
        } else {
          this.sendJson(res, 500, { error: result.error });
        }
        return;
      }

      // GET /handoff/:key - Load handoff
      if (method === "GET" && path === "/handoff/:key" && key) {
        const maxMessages = query.get("max_messages");
        const result = await this.storage.load(
          key,
          maxMessages ? Number.parseInt(maxMessages, 10) : undefined
        );
        if (result.success) {
          this.sendJson(res, 200, result.data);
        } else {
          this.sendJson(res, 404, { error: result.error });
        }
        return;
      }

      // DELETE /handoff/:key - Clear specific handoff
      if (method === "DELETE" && path === "/handoff/:key" && key) {
        const result = await this.storage.clear(key);
        if (result.success) {
          this.sendJson(res, 200, result.data);
        } else {
          this.sendJson(res, 404, { error: result.error });
        }
        return;
      }

      // DELETE /handoff - Clear all handoffs
      if (method === "DELETE" && path === "/handoff") {
        const result = await this.storage.clear();
        if (result.success) {
          this.sendJson(res, 200, result.data);
        } else {
          this.sendJson(res, 500, { error: result.error });
        }
        return;
      }

      // GET /stats - Get storage stats
      if (method === "GET" && path === "/stats") {
        const result = await this.storage.stats();
        if (result.success) {
          this.sendJson(res, 200, result.data);
        } else {
          this.sendJson(res, 500, { error: result.error });
        }
        return;
      }

      // GET / - Health check
      if (method === "GET" && path === "/") {
        this.sendJson(res, 200, {
          name: "conversation-handoff-server",
          status: "running",
          port: this.port,
        });
        return;
      }

      // Not found
      this.sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.sendJson(res, 500, { error: message });
    }
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => {
        this.handleRequest(req, res).catch((error) => {
          console.error("Request error:", error);
          this.sendJson(res, 500, { error: "Internal server error" });
        });
      });

      server.listen(this.port, () => {
        console.log(`Conversation Handoff Server running on http://localhost:${this.port}`);
        console.log("");
        console.log("Endpoints:");
        console.log("  POST   /handoff       - Save a handoff");
        console.log("  GET    /handoff       - List all handoffs");
        console.log("  GET    /handoff/:key  - Load a specific handoff");
        console.log("  DELETE /handoff/:key  - Delete a specific handoff");
        console.log("  DELETE /handoff       - Delete all handoffs");
        console.log("  GET    /stats         - Get storage statistics");
        console.log("");
        console.log("Configure MCP clients with:");
        console.log(`  HANDOFF_SERVER=http://localhost:${this.port}`);
        resolve();
      });

      server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          console.error(`Error: Port ${this.port} is already in use`);
          process.exit(1);
        }
        throw error;
      });
    });
  }
}

export async function startServer(port: number = DEFAULT_PORT): Promise<void> {
  const server = new HttpServer(port);
  await server.start();
}
