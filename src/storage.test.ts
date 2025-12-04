import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorage, type SaveInput } from "./storage.js";
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
      expect((summary as Record<string, unknown>)?.conversation).toBeUndefined();
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
