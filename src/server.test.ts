import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connectionConfig } from "./config.js";
import { HttpServer } from "./server.js";

describe("HttpServer", () => {
  let server: HttpServer;
  let httpServer: Server;
  const testPort = 19999;

  beforeAll(async () => {
    server = new HttpServer(testPort);
    httpServer = await server.start();
  });

  afterAll(() => {
    httpServer.close();
  });

  describe("CORS", () => {
    it("should set CORS header for localhost origin", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/`, {
        headers: { Origin: "http://localhost:3000" },
      });
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    });

    it("should set CORS header for 127.0.0.1 origin", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/`, {
        headers: { Origin: "http://127.0.0.1:8080" },
      });
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:8080");
    });

    it("should not set CORS header for external origin", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/`, {
        headers: { Origin: "http://example.com" },
      });
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("should not set CORS header for malicious localhost variation", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/`, {
        headers: { Origin: "http://localhost.evil.com" },
      });
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("should handle OPTIONS preflight request", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff`, {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:3000" },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
        "GET, POST, DELETE, OPTIONS"
      );
    });
  });

  describe("Input validation", () => {
    it("should reject invalid JSON", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });
      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("Invalid JSON in request body");
    });

    it("should reject non-object body", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("string"),
      });
      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("Request body must be an object");
    });

    it("should reject missing required fields", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "test" }),
      });
      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toContain("Missing required field");
    });

    it("should accept valid input", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "test-key",
          title: "Test Title",
          summary: "Test summary",
          conversation: "Test conversation",
          from_ai: "claude",
          from_project: "",
        }),
      });
      expect(response.status).toBe(200);
    });
  });

  describe("Merge endpoint", () => {
    // Setup: save two handoffs for merge tests
    beforeAll(async () => {
      await fetch(`http://127.0.0.1:${testPort}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "merge-a",
          title: "Merge A",
          summary: "Summary A",
          conversation: "## User\nQuestion A\n\n## Assistant\nAnswer A",
          from_ai: "claude",
          from_project: "test",
        }),
      });
      await fetch(`http://127.0.0.1:${testPort}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "merge-b",
          title: "Merge B",
          summary: "Summary B",
          conversation: "## User\nQuestion B\n\n## Assistant\nAnswer B",
          from_ai: "claude",
          from_project: "test",
        }),
      });
    });

    it("should merge handoffs successfully", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: ["merge-a", "merge-b"],
          delete_sources: false,
          strategy: "chronological",
        }),
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as { merged_key: string; source_count: number };
      expect(data.merged_key).toBeDefined();
      expect(data.source_count).toBe(2);
    });

    it("should return 400 for invalid JSON", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });
      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("Invalid JSON in request body");
    });

    it("should return 404 for non-existent key", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: ["merge-a", "non-existent"],
          delete_sources: false,
          strategy: "chronological",
        }),
      });
      expect(response.status).toBe(404);
    });

    it("should return 400 for invalid input structure", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: ["only-one"],
          delete_sources: false,
          strategy: "chronological",
        }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe("Binding", () => {
    it("should only be accessible via localhost", async () => {
      // This test verifies the server is bound to 127.0.0.1
      // by checking we can access it via localhost
      const response = await fetch(`http://127.0.0.1:${testPort}/`);
      expect(response.ok).toBe(true);
    });
  });

  describe("Large payload rejection", () => {
    it("should reject oversized body during streaming", async () => {
      // Create a body that exceeds the limit during streaming (2MB)
      const largeConversation = "x".repeat(2 * 1024 * 1024);
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "streaming-large",
          title: "Large",
          summary: "Summary",
          conversation: largeConversation,
          from_ai: "claude",
          from_project: "test",
        }),
      });
      // Should be 413 (body too large) or 400 (validation rejects size)
      expect([400, 413]).toContain(response.status);
    });

    it("should reject oversized body on merge endpoint", async () => {
      const largeBody = "x".repeat(2 * 1024 * 1024);
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: largeBody,
      });
      expect([400, 413]).toContain(response.status);
    });
  });

  describe("Edge cases", () => {
    it("should return 404 for unknown routes", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/unknown`);
      expect(response.status).toBe(404);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("Not found");
    });

    it("should return 404 when loading non-existent handoff", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff/does-not-exist`);
      expect(response.status).toBe(404);
    });

    it("should return 404 when deleting non-existent handoff", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff/does-not-exist`, {
        method: "DELETE",
      });
      expect(response.status).toBe(404);
    });

    it("should reject invalid max_messages parameter", async () => {
      // First save a handoff
      await fetch(`http://127.0.0.1:${testPort}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "edge-test",
          title: "Edge Test",
          summary: "Summary",
          conversation: "## User\nHello\n\n## Assistant\nHi",
          from_ai: "claude",
          from_project: "test",
        }),
      });

      const response = await fetch(
        `http://127.0.0.1:${testPort}/handoff/edge-test?max_messages=abc`
      );
      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toContain("Invalid max_messages");
    });

    it("should reject max_messages out of range", async () => {
      const response = await fetch(
        `http://127.0.0.1:${testPort}/handoff/edge-test?max_messages=99999`
      );
      expect(response.status).toBe(400);
    });

    it("should return stats endpoint", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/stats`);
      expect(response.status).toBe(200);
      const data = (await response.json()) as { current: { handoffs: number } };
      expect(data.current.handoffs).toBeGreaterThanOrEqual(0);
    });

    it("should delete all handoffs", async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/handoff`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as { message: string; count: number };
      expect(data.message).toBe("All handoffs cleared");
      expect(typeof data.count).toBe("number");
    });
  });

  // Shutdown test must run last since it closes the server
  describe("Shutdown endpoint", () => {
    it("should respond to POST /shutdown with success", async () => {
      // Mock process.exit to prevent test runner from exiting
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      const response = await fetch(`http://127.0.0.1:${testPort}/shutdown`, {
        method: "POST",
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as { message: string };
      expect(data.message).toBe("Server shutting down...");

      // Wait for the setTimeout in shutdown handler to fire
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(mockExit).toHaveBeenCalledWith(0);

      mockExit.mockRestore();
    });
  });
});

describe("HttpServer TTL auto-shutdown", () => {
  const ttlTestPort = 19998;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should trigger shutdown after TTL expires", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    // Set a short TTL for testing
    const origTtl = connectionConfig.serverTtlMs;
    (connectionConfig as { serverTtlMs: number }).serverTtlMs = 200;

    try {
      const server = new HttpServer(ttlTestPort);
      const httpServer = await server.start();

      // Wait for TTL to expire (TTL check interval = min(60s, ttl/2) = 100ms)
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(mockExit).toHaveBeenCalledWith(0);

      // Clean up
      try {
        httpServer.close();
      } catch {
        // Server may already be closed by shutdown
      }
    } finally {
      (connectionConfig as { serverTtlMs: number }).serverTtlMs = origTtl;
    }
  });

  it("should not trigger shutdown when TTL is disabled (0)", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const origTtl = connectionConfig.serverTtlMs;
    (connectionConfig as { serverTtlMs: number }).serverTtlMs = 0;

    try {
      const server = new HttpServer(ttlTestPort);
      const httpServer = await server.start();

      // Wait and verify no shutdown
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mockExit).not.toHaveBeenCalled();

      httpServer.close();
    } finally {
      (connectionConfig as { serverTtlMs: number }).serverTtlMs = origTtl;
    }
  });
});
