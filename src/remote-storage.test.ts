import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionConfig } from "./config.js";
import { RemoteStorage } from "./remote-storage.js";
import type { SaveInput } from "./types.js";

describe("RemoteStorage - advanced", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe("retry exhaustion", () => {
    it("should fail when reconnectFn returns null (server not found)", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const mockReconnect = vi.fn().mockResolvedValue(null);
      const storage = new RemoteStorage("http://localhost:1099", mockReconnect);
      const result = await storage.list();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to connect to server");
      // reconnectFn is called once per connection failure
      expect(mockReconnect).toHaveBeenCalledTimes(1);
    });

    it("should stop retrying after maxReconnectAttempts with repeated reconnection", async () => {
      // Each reconnect "succeeds" (returns URL) but the fetch still fails,
      // causing recursive retries until maxReconnectAttempts is exhausted.
      // Use a small retryCount to avoid long test times.
      const origRetryCount = connectionConfig.retryCount;
      const origRetryInterval = connectionConfig.retryIntervalMs;
      // Temporarily reduce retry settings for test speed
      (connectionConfig as { retryCount: number }).retryCount = 3;
      (connectionConfig as { retryIntervalMs: number }).retryIntervalMs = 0;

      try {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

        const mockReconnect = vi.fn().mockResolvedValue("http://localhost:2000");
        const storage = new RemoteStorage("http://localhost:1099", mockReconnect);
        const result = await storage.list();

        expect(result.success).toBe(false);
        expect(result.error).toContain("Failed to connect to server");
        expect(mockReconnect).toHaveBeenCalledTimes(3);
      } finally {
        (connectionConfig as { retryCount: number }).retryCount = origRetryCount;
        (connectionConfig as { retryIntervalMs: number }).retryIntervalMs = origRetryInterval;
      }
    });

    it("should not call reconnectFn when none is provided", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const storage = new RemoteStorage("http://localhost:1099");
      const result = await storage.list();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to connect to server");
    });
  });

  describe("pendingContent recovery", () => {
    it("should include pendingContent in error result for save operations", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const storage = new RemoteStorage("http://localhost:1099");
      const saveInput: SaveInput = {
        key: "test-key",
        title: "Test",
        summary: "Summary",
        conversation: "Conversation content",
        from_ai: "claude",
        from_project: "test-project",
      };

      const result = await storage.save(saveInput);

      expect(result.success).toBe(false);
      expect(result.pendingContent).toEqual(saveInput);
      expect(result.suggestion).toContain("manual recovery");
    });

    it("should not include pendingContent for non-save operations", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const storage = new RemoteStorage("http://localhost:1099");
      const result = await storage.list();

      expect(result.success).toBe(false);
      expect(result.pendingContent).toBeUndefined();
    });
  });

  describe("timeout handling", () => {
    it("should abort request on timeout", async () => {
      // Mock fetch that never resolves until aborted
      globalThis.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });

      const storage = new RemoteStorage("http://localhost:1099");
      const resultPromise = storage.list();

      // Advance past the fetch timeout
      await vi.advanceTimersByTimeAsync(connectionConfig.fetchTimeoutMs + 100);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to connect to server");
    });
  });

  describe("concurrent requests during reconnection", () => {
    it("should handle multiple concurrent requests when server is down", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(new Error("ECONNREFUSED"));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      });

      const storage = new RemoteStorage("http://localhost:1099");

      // Launch two concurrent requests
      const [result1, result2] = await Promise.all([storage.list(), storage.list()]);

      // Both should fail since no reconnectFn is provided
      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
    });
  });

  describe("HTTP method routing", () => {
    it("should send POST for save", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: "Saved" }),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      await storage.save({
        key: "test",
        title: "Test",
        summary: "Summary",
        conversation: "Conv",
        from_ai: "claude",
        from_project: "test",
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1099/handoff",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("should send GET for list", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      await storage.list();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1099/handoff",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("should send GET with key for load", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ key: "test" }),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      await storage.load("test-key");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1099/handoff/test-key",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("should encode special characters in key for load", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ key: "test key" }),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      await storage.load("test key");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1099/handoff/test%20key",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("should pass max_messages query parameter for load", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ key: "test" }),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      await storage.load("test-key", 5);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1099/handoff/test-key?max_messages=5",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("should send DELETE for clear with key", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: "Cleared" }),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      await storage.clear("test-key");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1099/handoff/test-key",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("should send DELETE for clear all", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: "All cleared" }),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      await storage.clear();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1099/handoff",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("should send GET for stats", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ current: {} }),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      await storage.stats();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1099/stats",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("should send POST for merge", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ merged_key: "merged", source_count: 2 }),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      await storage.merge({
        keys: ["a", "b"],
        delete_sources: false,
        strategy: "chronological",
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1099/handoff/merge",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("exponential backoff", () => {
    it("should apply exponential backoff delays between retry attempts", async () => {
      const origRetryCount = connectionConfig.retryCount;
      const origRetryInterval = connectionConfig.retryIntervalMs;
      const origInitialInterval = connectionConfig.retryInitialIntervalMs;
      const origMaxTotal = connectionConfig.retryMaxTotalMs;

      // Configure for predictable backoff: 100, 200, 400 (capped at 500)
      (connectionConfig as { retryCount: number }).retryCount = 4;
      (connectionConfig as { retryIntervalMs: number }).retryIntervalMs = 500;
      (connectionConfig as { retryInitialIntervalMs: number }).retryInitialIntervalMs = 100;
      (connectionConfig as { retryMaxTotalMs: number }).retryMaxTotalMs = 60000;

      try {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

        const delays: number[] = [];
        // Track sleep calls to verify backoff pattern
        const sleepSpy = vi.spyOn(await import("./validation.js"), "sleep");
        sleepSpy.mockImplementation(async (ms: number) => {
          delays.push(ms);
        });

        const mockReconnect = vi.fn().mockResolvedValue("http://localhost:2000");
        const storage = new RemoteStorage("http://localhost:1099", mockReconnect);
        await storage.list();

        // First attempt has no delay, subsequent attempts have exponential backoff
        // Attempt 1: no delay, attempt 2: 100ms, attempt 3: 200ms, attempt 4: 400ms
        expect(delays).toEqual([100, 200, 400]);
        expect(mockReconnect).toHaveBeenCalledTimes(4);

        sleepSpy.mockRestore();
      } finally {
        (connectionConfig as { retryCount: number }).retryCount = origRetryCount;
        (connectionConfig as { retryIntervalMs: number }).retryIntervalMs = origRetryInterval;
        (connectionConfig as { retryInitialIntervalMs: number }).retryInitialIntervalMs =
          origInitialInterval;
        (connectionConfig as { retryMaxTotalMs: number }).retryMaxTotalMs = origMaxTotal;
      }
    });

    it("should cap backoff delay at retryIntervalMs", async () => {
      const origRetryCount = connectionConfig.retryCount;
      const origRetryInterval = connectionConfig.retryIntervalMs;
      const origInitialInterval = connectionConfig.retryInitialIntervalMs;
      const origMaxTotal = connectionConfig.retryMaxTotalMs;

      // Cap at 150ms: delays would be 100, 150 (capped from 200), 150 (capped from 400)
      (connectionConfig as { retryCount: number }).retryCount = 4;
      (connectionConfig as { retryIntervalMs: number }).retryIntervalMs = 150;
      (connectionConfig as { retryInitialIntervalMs: number }).retryInitialIntervalMs = 100;
      (connectionConfig as { retryMaxTotalMs: number }).retryMaxTotalMs = 60000;

      try {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

        const delays: number[] = [];
        const sleepSpy = vi.spyOn(await import("./validation.js"), "sleep");
        sleepSpy.mockImplementation(async (ms: number) => {
          delays.push(ms);
        });

        const mockReconnect = vi.fn().mockResolvedValue("http://localhost:2000");
        const storage = new RemoteStorage("http://localhost:1099", mockReconnect);
        await storage.list();

        expect(delays).toEqual([100, 150, 150]);

        sleepSpy.mockRestore();
      } finally {
        (connectionConfig as { retryCount: number }).retryCount = origRetryCount;
        (connectionConfig as { retryIntervalMs: number }).retryIntervalMs = origRetryInterval;
        (connectionConfig as { retryInitialIntervalMs: number }).retryInitialIntervalMs =
          origInitialInterval;
        (connectionConfig as { retryMaxTotalMs: number }).retryMaxTotalMs = origMaxTotal;
      }
    });

    it("should stop retrying when total time exceeds retryMaxTotalMs", async () => {
      const origRetryCount = connectionConfig.retryCount;
      const origRetryInterval = connectionConfig.retryIntervalMs;
      const origInitialInterval = connectionConfig.retryInitialIntervalMs;
      const origMaxTotal = connectionConfig.retryMaxTotalMs;

      // High retry count but short total time limit (250ms)
      // Backoff: attempt 1 = no delay, attempt 2 = 100ms (elapsed 100),
      // attempt 3 = 200ms (elapsed 300 > 250) -> stop
      (connectionConfig as { retryCount: number }).retryCount = 100;
      (connectionConfig as { retryIntervalMs: number }).retryIntervalMs = 5000;
      (connectionConfig as { retryInitialIntervalMs: number }).retryInitialIntervalMs = 100;
      (connectionConfig as { retryMaxTotalMs: number }).retryMaxTotalMs = 250;

      try {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

        // Mock sleep to be a no-op but advance Date.now
        let elapsed = 0;
        const realDateNow = Date.now;
        const startTime = realDateNow.call(Date);
        vi.spyOn(Date, "now").mockImplementation(() => startTime + elapsed);

        const sleepSpy = vi.spyOn(await import("./validation.js"), "sleep");
        sleepSpy.mockImplementation(async (ms: number) => {
          elapsed += ms;
        });

        // reconnectFn returns URL so request retries recursively,
        // but fetch keeps failing, accumulating total elapsed time
        const mockReconnect = vi.fn().mockResolvedValue("http://localhost:2000");
        const storage = new RemoteStorage("http://localhost:1099", mockReconnect);
        const result = await storage.list();

        expect(result.success).toBe(false);
        // Should have stopped before exhausting retryCount (100) due to total time limit
        expect(mockReconnect.mock.calls.length).toBeLessThan(100);
        expect(mockReconnect.mock.calls.length).toBeGreaterThan(1);

        sleepSpy.mockRestore();
        vi.spyOn(Date, "now").mockRestore();
      } finally {
        (connectionConfig as { retryCount: number }).retryCount = origRetryCount;
        (connectionConfig as { retryIntervalMs: number }).retryIntervalMs = origRetryInterval;
        (connectionConfig as { retryInitialIntervalMs: number }).retryInitialIntervalMs =
          origInitialInterval;
        (connectionConfig as { retryMaxTotalMs: number }).retryMaxTotalMs = origMaxTotal;
      }
    });
  });

  describe("reconnection with URL update", () => {
    it("should use new URL after successful reconnection", async () => {
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation((_url: string) => {
        callCount++;
        // First call to old server fails
        if (callCount === 1) {
          return Promise.reject(new Error("ECONNREFUSED"));
        }
        // Subsequent calls to new server succeed
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      });
      globalThis.fetch = fetchMock;

      const mockReconnect = vi.fn().mockResolvedValue("http://localhost:2000");
      const storage = new RemoteStorage("http://localhost:1099", mockReconnect);
      const result = await storage.list();

      expect(result.success).toBe(true);
      // Second fetch call should use new URL
      expect(fetchMock).toHaveBeenLastCalledWith(
        "http://localhost:2000/handoff",
        expect.any(Object)
      );
    });
  });
});
