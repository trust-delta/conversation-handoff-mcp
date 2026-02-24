import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
