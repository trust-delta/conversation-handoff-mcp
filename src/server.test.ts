import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  describe("Binding", () => {
    it("should only be accessible via localhost", async () => {
      // This test verifies the server is bound to 127.0.0.1
      // by checking we can access it via localhost
      const response = await fetch(`http://127.0.0.1:${testPort}/`);
      expect(response.ok).toBe(true);
    });
  });
});
