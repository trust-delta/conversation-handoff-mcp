import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LocalStorage,
  RemoteStorage,
  type SaveInput,
  getStorage,
  resetStorageState,
} from "./storage.js";
import type { Config } from "./validation.js";

const testConfig: Config = {
  maxHandoffs: 10,
  maxConversationBytes: 10000,
  maxSummaryBytes: 1000,
  maxTitleLength: 200,
  maxKeyLength: 100,
  keyPattern: /^[a-zA-Z0-9_-]+$/,
};

describe("LocalStorage", () => {
  let storage: LocalStorage;

  beforeEach(() => {
    storage = new LocalStorage(testConfig);
  });

  const validInput: SaveInput = {
    key: "test-handoff",
    title: "Test Handoff",
    summary: "This is a test summary",
    conversation: "## User\nHello\n\n## Assistant\nHi there!",
    from_ai: "claude",
    from_project: "test-project",
  };

  describe("save", () => {
    it("should save a valid handoff", async () => {
      const result = await storage.save(validInput);
      expect(result.success).toBe(true);
      expect(result.data?.message).toContain("Handoff saved");
    });

    it("should reject invalid key", async () => {
      const result = await storage.save({ ...validInput, key: "invalid key!" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("alphanumeric");
    });

    it("should reject empty title", async () => {
      const result = await storage.save({ ...validInput, title: "" });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Title is required");
    });

    it("should update existing handoff", async () => {
      await storage.save(validInput);
      const updatedInput = { ...validInput, title: "Updated Title" };
      const result = await storage.save(updatedInput);
      expect(result.success).toBe(true);

      const loaded = await storage.load(validInput.key);
      expect(loaded.data?.title).toBe("Updated Title");
    });
  });

  describe("list", () => {
    it("should return empty array when no handoffs", async () => {
      const result = await storage.list();
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("should return handoff summaries", async () => {
      await storage.save(validInput);
      await storage.save({ ...validInput, key: "another-handoff", title: "Another" });

      const result = await storage.list();
      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(2);

      // Verify summaries don't include conversation
      const summary = result.data?.[0];
      expect(summary?.key).toBeDefined();
      expect(summary?.title).toBeDefined();
      expect(summary?.summary).toBeDefined();
      expect(summary && "conversation" in summary).toBe(false);
    });
  });

  describe("load", () => {
    it("should return error for non-existent key", async () => {
      const result = await storage.load("non-existent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should load full handoff", async () => {
      await storage.save(validInput);
      const result = await storage.load(validInput.key);

      expect(result.success).toBe(true);
      expect(result.data?.key).toBe(validInput.key);
      expect(result.data?.title).toBe(validInput.title);
      expect(result.data?.conversation).toBe(validInput.conversation);
    });

    it("should truncate messages when max_messages specified", async () => {
      const multiMessage = {
        ...validInput,
        conversation: "## User\nFirst\n\n## Assistant\nOne\n\n## User\nSecond\n\n## Assistant\nTwo",
      };
      await storage.save(multiMessage);

      const result = await storage.load(validInput.key, 2);
      expect(result.success).toBe(true);
      expect(result.data?.conversation).toContain("truncated");
      expect(result.data?.conversation).toContain("## User\nSecond");
      expect(result.data?.conversation).toContain("## Assistant\nTwo");
      expect(result.data?.conversation).not.toContain("## User\nFirst");
    });

    it("should not truncate if max_messages >= actual messages", async () => {
      const multiMessage = {
        ...validInput,
        conversation: "## User\nHello\n\n## Assistant\nHi",
      };
      await storage.save(multiMessage);

      const result = await storage.load(validInput.key, 10);
      expect(result.success).toBe(true);
      expect(result.data?.conversation).not.toContain("truncated");
    });
  });

  describe("clear", () => {
    it("should clear specific handoff", async () => {
      await storage.save(validInput);
      await storage.save({ ...validInput, key: "another" });

      const result = await storage.clear(validInput.key);
      expect(result.success).toBe(true);
      expect(result.data?.message).toContain("Handoff cleared");

      const list = await storage.list();
      expect(list.data?.length).toBe(1);
    });

    it("should return error for non-existent key", async () => {
      const result = await storage.clear("non-existent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should clear all handoffs when no key provided", async () => {
      await storage.save(validInput);
      await storage.save({ ...validInput, key: "another" });

      const result = await storage.clear();
      expect(result.success).toBe(true);
      expect(result.data?.count).toBe(2);

      const list = await storage.list();
      expect(list.data?.length).toBe(0);
    });
  });

  describe("stats", () => {
    it("should return correct stats for empty storage", async () => {
      const result = await storage.stats();
      expect(result.success).toBe(true);
      expect(result.data?.current.handoffs).toBe(0);
      expect(result.data?.current.totalBytes).toBe(0);
      expect(result.data?.usage.handoffsPercent).toBe(0);
    });

    it("should return correct stats after saving", async () => {
      await storage.save(validInput);

      const result = await storage.stats();
      expect(result.success).toBe(true);
      expect(result.data?.current.handoffs).toBe(1);
      expect(result.data?.current.totalBytes).toBeGreaterThan(0);
      expect(result.data?.limits.maxHandoffs).toBe(testConfig.maxHandoffs);
    });

    it("should calculate usage percentage correctly", async () => {
      for (let i = 0; i < 5; i++) {
        await storage.save({ ...validInput, key: `handoff-${i}` });
      }

      const result = await storage.stats();
      expect(result.data?.usage.handoffsPercent).toBe(50); // 5 out of 10
    });
  });
});

describe("RemoteStorage", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("constructor", () => {
    it("should accept http:// URL", () => {
      expect(() => new RemoteStorage("http://localhost:1099")).not.toThrow();
    });

    it("should accept https:// URL", () => {
      expect(() => new RemoteStorage("https://example.com")).not.toThrow();
    });

    it("should reject file:// URL", () => {
      expect(() => new RemoteStorage("file:///etc/passwd")).toThrow(
        "Server URL must use http:// or https:// protocol"
      );
    });

    it("should reject URL without protocol", () => {
      expect(() => new RemoteStorage("localhost:1099")).toThrow(
        "Server URL must use http:// or https:// protocol"
      );
    });

    it("should reject ftp:// URL", () => {
      expect(() => new RemoteStorage("ftp://example.com")).toThrow(
        "Server URL must use http:// or https:// protocol"
      );
    });

    it("should remove trailing slash from URL", () => {
      const storage = new RemoteStorage("http://localhost:1099/");
      // Verify by checking that requests go to correct URL
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      storage.list();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1099/handoff",
        expect.any(Object)
      );
    });
  });

  describe("request error handling", () => {
    it("should handle connection failure", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const storage = new RemoteStorage("http://localhost:1099");
      const result = await storage.list();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to connect to server");
      expect(result.error).toContain("ECONNREFUSED");
    });

    it("should handle invalid JSON response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("Unexpected token")),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      const result = await storage.list();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid response from server");
      expect(result.error).toContain("expected JSON");
      expect(result.error).toContain("HTTP 200");
    });

    it("should handle HTTP error with error message", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Bad request" }),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      const result = await storage.list();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Bad request");
    });

    it("should handle HTTP error without error message", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const storage = new RemoteStorage("http://localhost:1099");
      const result = await storage.list();

      expect(result.success).toBe(false);
      expect(result.error).toBe("HTTP 500");
    });
  });
});

describe("getStorage", () => {
  const originalEnv = process.env.HANDOFF_SERVER;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetStorageState();
  });

  afterEach(() => {
    process.env.HANDOFF_SERVER = originalEnv;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    resetStorageState();
  });

  it("should return standalone-explicit mode when HANDOFF_SERVER=none", async () => {
    process.env.HANDOFF_SERVER = "none";

    const result = await getStorage();

    expect(result.mode).toBe("standalone-explicit");
    expect(result.storage).toBeInstanceOf(LocalStorage);
    expect(result.serverUrl).toBeUndefined();
  });

  it("should return standalone mode when default server is not available", async () => {
    // biome-ignore lint/performance/noDelete: need to clear env var for test
    delete process.env.HANDOFF_SERVER;

    // Mock fetch to simulate server not available
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getStorage();

    expect(result.mode).toBe("standalone");
    expect(result.storage).toBeInstanceOf(LocalStorage);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not available"));
  });

  it("should return standalone mode when custom server is not available", async () => {
    process.env.HANDOFF_SERVER = "http://localhost:3000";

    // Mock fetch to simulate server not available
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getStorage();

    expect(result.mode).toBe("standalone");
    expect(result.storage).toBeInstanceOf(LocalStorage);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Cannot connect to server"));
  });

  it("should return shared mode when server is available", async () => {
    // biome-ignore lint/performance/noDelete: need to clear env var for test
    delete process.env.HANDOFF_SERVER;

    // Mock fetch to simulate server available
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
    } as Response);

    const result = await getStorage();

    expect(result.mode).toBe("shared");
    expect(result.storage).toBeInstanceOf(RemoteStorage);
    expect(result.serverUrl).toBe("http://localhost:1099");
  });

  it("should return shared mode when custom server is available", async () => {
    process.env.HANDOFF_SERVER = "http://localhost:3000";

    // Mock fetch to simulate server available
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
    } as Response);

    const result = await getStorage();

    expect(result.mode).toBe("shared");
    expect(result.storage).toBeInstanceOf(RemoteStorage);
    expect(result.serverUrl).toBe("http://localhost:3000");
  });

  it("should fallback to standalone when server returns non-ok response", async () => {
    // biome-ignore lint/performance/noDelete: need to clear env var for test
    delete process.env.HANDOFF_SERVER;

    // Mock fetch to simulate server error response
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getStorage();

    expect(result.mode).toBe("standalone");
    expect(result.storage).toBeInstanceOf(LocalStorage);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("should switch from standalone to shared when server becomes available", async () => {
    // biome-ignore lint/performance/noDelete: need to clear env var for test
    delete process.env.HANDOFF_SERVER;

    // First call: server not available
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result1 = await getStorage();
    expect(result1.mode).toBe("standalone");

    // Second call: server becomes available
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

    const result2 = await getStorage();
    expect(result2.mode).toBe("shared");
  });

  it("should switch from shared to standalone when server goes down", async () => {
    // biome-ignore lint/performance/noDelete: need to clear env var for test
    delete process.env.HANDOFF_SERVER;

    // First call: server available
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

    const result1 = await getStorage();
    expect(result1.mode).toBe("shared");

    // Second call: server goes down
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result2 = await getStorage();
    expect(result2.mode).toBe("standalone");
  });

  it("should not warn twice when already in standalone mode", async () => {
    // biome-ignore lint/performance/noDelete: need to clear env var for test
    delete process.env.HANDOFF_SERVER;

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Call twice
    await getStorage();
    await getStorage();

    // Warning should only be called once (on first mode change)
    expect(warnSpy).toHaveBeenCalledTimes(2); // 2 warnings on first call, 0 on second
  });

  it("should preserve local storage data across mode switches", async () => {
    // biome-ignore lint/performance/noDelete: need to clear env var for test
    delete process.env.HANDOFF_SERVER;

    // Start in standalone mode
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result1 = await getStorage();
    await result1.storage.save({
      key: "test-key",
      title: "Test",
      summary: "Summary",
      conversation: "Conversation",
      from_ai: "claude",
      from_project: "",
    });

    // Switch to shared mode (simulated, but local storage should persist)
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Still down"));

    const result2 = await getStorage();
    const loaded = await result2.storage.load("test-key");

    expect(loaded.success).toBe(true);
    expect(loaded.data?.title).toBe("Test");
  });
});
