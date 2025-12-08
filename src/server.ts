import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { Server } from "node:http";
import { findAvailablePort } from "./autoconnect.js";
import { LocalStorage, type SaveInput } from "./storage.js";
import { connectionConfig, defaultConfig } from "./validation.js";

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
  private lastRequestTime: number = Date.now();
  private ttlCheckInterval: ReturnType<typeof setInterval> | null = null;
  private server: Server | null = null;

  constructor(port: number = DEFAULT_PORT) {
    // Use memory-based storage (data is shared across MCP clients via HTTP)
    this.storage = new LocalStorage();
    this.port = port;
  }

  /**
   * Update last request time (called on every request)
   */
  private touchLastRequest(): void {
    this.lastRequestTime = Date.now();
  }

  /**
   * Start TTL monitoring (auto-shutdown after inactivity)
   */
  private startTtlMonitor(): void {
    const ttlMs = connectionConfig.serverTtlMs;

    // TTL disabled if 0
    if (ttlMs <= 0) {
      return;
    }

    // Check every minute
    const checkIntervalMs = Math.min(60 * 1000, ttlMs / 2);

    this.ttlCheckInterval = setInterval(() => {
      const elapsed = Date.now() - this.lastRequestTime;
      if (elapsed >= ttlMs) {
        console.log(
          `Server TTL expired (no requests for ${Math.round(ttlMs / 1000 / 60)} minutes). Shutting down...`
        );
        this.shutdown();
      }
    }, checkIntervalMs);

    // Don't keep process alive just for TTL check
    this.ttlCheckInterval.unref();
  }

  /**
   * Shutdown the server gracefully
   */
  private shutdown(): void {
    if (this.ttlCheckInterval) {
      clearInterval(this.ttlCheckInterval);
      this.ttlCheckInterval = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    process.exit(0);
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    // Calculate max body size: conversation + summary + metadata overhead
    const maxBodySize =
      defaultConfig.maxConversationBytes + defaultConfig.maxSummaryBytes + 10 * 1024;

    // Check Content-Length header first
    const contentLength = req.headers["content-length"];
    if (contentLength) {
      const length = Number.parseInt(contentLength, 10);
      if (!Number.isNaN(length) && length > maxBodySize) {
        throw new Error(`Request body too large (max: ${maxBodySize} bytes)`);
      }
    }

    return new Promise((resolve, reject) => {
      let body = "";
      let receivedBytes = 0;

      req.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxBodySize) {
          req.destroy();
          reject(new Error(`Request body too large (max: ${maxBodySize} bytes)`));
          return;
        }
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
    // Update last request time for TTL monitoring
    this.touchLastRequest();

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

        let input: SaveInput;
        try {
          input = JSON.parse(body) as SaveInput;
        } catch {
          this.sendJson(res, 400, { error: "Invalid JSON in request body" });
          return;
        }

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
        const maxMessagesParam = query.get("max_messages");
        let maxMessages: number | undefined;

        if (maxMessagesParam) {
          const parsed = Number.parseInt(maxMessagesParam, 10);
          if (Number.isNaN(parsed) || parsed < 1 || parsed > 10000) {
            this.sendJson(res, 400, {
              error: "Invalid max_messages: must be a number between 1 and 10000",
            });
            return;
          }
          maxMessages = parsed;
        }

        const result = await this.storage.load(key, maxMessages);
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
      // Log error internally but don't expose details to client
      console.error("[conversation-handoff] Request error:", error);

      // Only expose safe error messages (body size limit)
      if (error instanceof Error && error.message.includes("Request body too large")) {
        this.sendJson(res, 413, { error: error.message });
        return;
      }

      this.sendJson(res, 500, { error: "Internal server error" });
    }
  }

  start(): Promise<Server> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((error) => {
          console.error("Request error:", error);
          this.sendJson(res, 500, { error: "Internal server error" });
        });
      });

      this.server.listen(this.port, () => {
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
        console.log("Note: Data is stored in memory and will be lost when server stops.");

        // Show TTL info if enabled
        const ttlMs = connectionConfig.serverTtlMs;
        if (ttlMs > 0) {
          const ttlMinutes = Math.round(ttlMs / 1000 / 60);
          console.log(`TTL: Server will auto-shutdown after ${ttlMinutes} minutes of inactivity.`);
        }

        // Start TTL monitoring
        this.startTtlMonitor();

        // biome-ignore lint/style/noNonNullAssertion: server is guaranteed to exist here
        resolve(this.server!);
      });

      this.server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          console.error(`Error: Port ${this.port} is already in use`);
          reject(error);
          return;
        }
        throw error;
      });

      // Cleanup on process exit
      const cleanup = () => {
        this.shutdown();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
    });
  }
}

export async function startServer(port?: number): Promise<void> {
  let targetPort = port ?? DEFAULT_PORT;

  // If no port specified and default is in use, find available port
  if (port === undefined) {
    const availablePort = await findAvailablePort(connectionConfig.portRange);
    if (availablePort !== null) {
      targetPort = availablePort;
    }
  }

  const server = new HttpServer(targetPort);
  await server.start();
}
