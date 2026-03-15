import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LocalStorage,
  type MergeInput,
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
  maxCommentBytes: 10000,
  maxCommentsPerHandoff: 50,
  maxCommentAuthorLength: 100,
  maxNextActionBytes: 2048,
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

    it("should return metadata with inputSizes on successful save", async () => {
      const result = await storage.save(validInput);
      expect(result.success).toBe(true);
      expect(result.metadata?.inputSizes).toBeDefined();
      expect(result.metadata?.inputSizes?.summaryBytes).toBe(
        Buffer.byteLength(validInput.summary, "utf8")
      );
      expect(result.metadata?.inputSizes?.conversationBytes).toBe(
        Buffer.byteLength(validInput.conversation, "utf8")
      );
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

    it("should auto-delete oldest handoff when at capacity (FIFO)", async () => {
      // Fill up to max capacity
      for (let i = 0; i < testConfig.maxHandoffs; i++) {
        await storage.save({
          ...validInput,
          key: `handoff-${i}`,
          title: `Handoff ${i}`,
        });
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Verify we're at capacity
      const listBefore = await storage.list();
      expect(listBefore.data?.length).toBe(testConfig.maxHandoffs);

      // Save one more - should succeed by deleting oldest
      const result = await storage.save({
        ...validInput,
        key: "new-handoff",
        title: "New Handoff",
      });
      expect(result.success).toBe(true);

      // Should still be at max capacity
      const listAfter = await storage.list();
      expect(listAfter.data?.length).toBe(testConfig.maxHandoffs);

      // Oldest (handoff-0) should be gone
      const oldestDeleted = await storage.load("handoff-0");
      expect(oldestDeleted.success).toBe(false);

      // New one should exist
      const newExists = await storage.load("new-handoff");
      expect(newExists.success).toBe(true);
    });

    it("should clear comments when overwriting existing key", async () => {
      await storage.save(validInput);
      await storage.addComment(validInput.key, "user", "Old comment");

      // Overwrite the handoff
      await storage.save({ ...validInput, title: "Updated Title" });

      const loaded = await storage.load(validInput.key);
      expect(loaded.data?.comments).toEqual([]);
    });

    it("should auto-calculate message_count and conversation_bytes", async () => {
      const result = await storage.save(validInput);
      expect(result.success).toBe(true);

      const loaded = await storage.load(validInput.key);
      expect(loaded.data?.message_count).toBe(2);
      expect(loaded.data?.conversation_bytes).toBe(
        Buffer.byteLength(validInput.conversation, "utf8")
      );
    });

    it("should use explicitly provided message_count and conversation_bytes", async () => {
      const result = await storage.save({
        ...validInput,
        message_count: 42,
        conversation_bytes: 9999,
      });
      expect(result.success).toBe(true);

      const loaded = await storage.load(validInput.key);
      expect(loaded.data?.message_count).toBe(42);
      expect(loaded.data?.conversation_bytes).toBe(9999);
    });

    it("should default status to 'active'", async () => {
      await storage.save(validInput);
      const loaded = await storage.load(validInput.key);
      expect(loaded.data?.status).toBe("active");
    });

    it("should use explicitly provided status", async () => {
      await storage.save({ ...validInput, status: "completed" });
      const loaded = await storage.load(validInput.key);
      expect(loaded.data?.status).toBe("completed");
    });

    it("should omit next_action when not provided", async () => {
      await storage.save(validInput);
      const loaded = await storage.load(validInput.key);
      expect(loaded.data && "next_action" in loaded.data).toBe(false);
    });

    it("should include next_action when explicitly provided", async () => {
      await storage.save({ ...validInput, next_action: "Run tests" });
      const loaded = await storage.load(validInput.key);
      expect(loaded.data?.next_action).toBe("Run tests");
    });

    it("should reject invalid status", async () => {
      const result = await storage.save({
        ...validInput,
        status: "invalid" as "active",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid status");
    });

    it("should reject oversized next_action", async () => {
      const result = await storage.save({
        ...validInput,
        next_action: "x".repeat(2049),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("exceeds maximum size");
    });

    it("should not delete when updating existing key at capacity", async () => {
      // Fill up to max capacity
      for (let i = 0; i < testConfig.maxHandoffs; i++) {
        await storage.save({
          ...validInput,
          key: `handoff-${i}`,
          title: `Handoff ${i}`,
        });
      }

      // Update existing key - should not delete anything
      const result = await storage.save({
        ...validInput,
        key: "handoff-5",
        title: "Updated Handoff 5",
      });
      expect(result.success).toBe(true);

      // All original keys should still exist
      for (let i = 0; i < testConfig.maxHandoffs; i++) {
        const loaded = await storage.load(`handoff-${i}`);
        expect(loaded.success).toBe(true);
      }
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
      expect(summary?.comment_count).toBe(0);
      expect(summary && "conversation" in summary).toBe(false);
    });

    it("should include metadata fields in summaries", async () => {
      await storage.save({ ...validInput, status: "completed", next_action: "Deploy" });

      const result = await storage.list();
      const summary = result.data?.[0];
      expect(summary?.message_count).toBe(2);
      expect(summary?.conversation_bytes).toBe(Buffer.byteLength(validInput.conversation, "utf8"));
      expect(summary?.status).toBe("completed");
      expect(summary?.next_action).toBe("Deploy");
    });

    it("should include comment_count in summaries", async () => {
      await storage.save(validInput);
      await storage.addComment(validInput.key, "user", "A comment");
      await storage.addComment(validInput.key, "user", "Another comment");

      const result = await storage.list();
      expect(result.data?.[0]?.comment_count).toBe(2);
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

    it("should include totalComments in stats", async () => {
      await storage.save(validInput);
      await storage.save({ ...validInput, key: "another" });
      await storage.addComment(validInput.key, "user", "Comment 1");
      await storage.addComment(validInput.key, "user", "Comment 2");
      await storage.addComment("another", "user", "Comment 3");

      const result = await storage.stats();
      expect(result.data?.current.totalComments).toBe(3);
    });

    it("should return 0 totalComments when no comments exist", async () => {
      const result = await storage.stats();
      expect(result.data?.current.totalComments).toBe(0);
    });
  });

  describe("merge", () => {
    const createHandoff = (key: string, overrides?: Partial<SaveInput>): SaveInput => ({
      ...validInput,
      key,
      title: `Title for ${key}`,
      summary: `Summary for ${key}`,
      conversation: `## User\nQuestion from ${key}\n\n## Assistant\nAnswer from ${key}`,
      ...overrides,
    });

    const baseMergeInput: MergeInput = {
      keys: ["h1", "h2"],
      delete_sources: false,
      strategy: "chronological",
    };

    it("should merge two handoffs with chronological strategy", async () => {
      await storage.save(createHandoff("h1"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      await storage.save(createHandoff("h2"));

      const result = await storage.merge(baseMergeInput);
      expect(result.success).toBe(true);
      expect(result.data?.source_count).toBe(2);
      expect(result.data?.merged_key).toBeDefined();

      const mergedKey = result.data?.merged_key ?? "";
      const loaded = await storage.load(mergedKey);
      expect(loaded.success).toBe(true);
      expect(loaded.data?.conversation).toContain("<!-- Source: h1 -->");
      expect(loaded.data?.conversation).toContain("<!-- Source: h2 -->");
      expect(loaded.data?.conversation).toContain("---");
    });

    it("should merge two handoffs with sequential strategy", async () => {
      // Save h2 first (older), h1 second (newer)
      await storage.save(createHandoff("h2"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      await storage.save(createHandoff("h1"));

      const result = await storage.merge({
        ...baseMergeInput,
        keys: ["h1", "h2"],
        strategy: "sequential",
      });
      expect(result.success).toBe(true);

      const seqKey = result.data?.merged_key ?? "";
      const loaded = await storage.load(seqKey);
      expect(loaded.success).toBe(true);
      // Sequential: h1 should come before h2 (array order)
      const conv = loaded.data?.conversation ?? "";
      const h1Pos = conv.indexOf("<!-- Source: h1 -->");
      const h2Pos = conv.indexOf("<!-- Source: h2 -->");
      expect(h1Pos).toBeLessThan(h2Pos);
    });

    it("should auto-generate key, title, and summary", async () => {
      await storage.save(createHandoff("h1"));
      await storage.save(createHandoff("h2"));

      const result = await storage.merge(baseMergeInput);
      expect(result.success).toBe(true);
      expect(result.data?.merged_key).toMatch(/^handoff-/);

      const autoKey = result.data?.merged_key ?? "";
      const loaded = await storage.load(autoKey);
      expect(loaded.success).toBe(true);
      expect(loaded.data?.summary).toContain("[h1]");
      expect(loaded.data?.summary).toContain("[h2]");
    });

    it("should use custom key, title, and summary when specified", async () => {
      await storage.save(createHandoff("h1"));
      await storage.save(createHandoff("h2"));

      const result = await storage.merge({
        ...baseMergeInput,
        new_key: "custom-merged",
        new_title: "Custom Title",
        new_summary: "Custom summary",
      });
      expect(result.success).toBe(true);
      expect(result.data?.merged_key).toBe("custom-merged");

      const loaded = await storage.load("custom-merged");
      expect(loaded.success).toBe(true);
      expect(loaded.data?.title).toBe("Custom Title");
      expect(loaded.data?.summary).toBe("Custom summary");
    });

    it("should delete sources when delete_sources is true", async () => {
      await storage.save(createHandoff("h1"));
      await storage.save(createHandoff("h2"));

      const result = await storage.merge({
        ...baseMergeInput,
        delete_sources: true,
      });
      expect(result.success).toBe(true);
      expect(result.data?.deleted_sources).toBe(true);

      // Source handoffs should be deleted
      const h1 = await storage.load("h1");
      expect(h1.success).toBe(false);
      const h2 = await storage.load("h2");
      expect(h2.success).toBe(false);
    });

    it("should keep sources when delete_sources is false", async () => {
      await storage.save(createHandoff("h1"));
      await storage.save(createHandoff("h2"));

      const result = await storage.merge({
        ...baseMergeInput,
        delete_sources: false,
      });
      expect(result.success).toBe(true);
      expect(result.data?.deleted_sources).toBe(false);

      // Source handoffs should still exist
      const h1 = await storage.load("h1");
      expect(h1.success).toBe(true);
      const h2 = await storage.load("h2");
      expect(h2.success).toBe(true);
    });

    it("should error when a key does not exist", async () => {
      await storage.save(createHandoff("h1"));

      const result = await storage.merge(baseMergeInput);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
      expect(result.error).toContain("h2");
    });

    it("should error on duplicate keys", async () => {
      await storage.save(createHandoff("h1"));

      const result = await storage.merge({
        ...baseMergeInput,
        keys: ["h1", "h1"],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Duplicate keys");
    });

    it("should error when merged conversation exceeds size limit", async () => {
      // Create handoffs with large conversations that exceed limit when combined
      const largeConv = "x".repeat(6000);
      await storage.save(createHandoff("h1", { conversation: largeConv }));
      await storage.save(createHandoff("h2", { conversation: largeConv }));

      const result = await storage.merge(baseMergeInput);
      expect(result.success).toBe(false);
      expect(result.error).toContain("too large");
    });

    it("should error when new_key conflicts with existing non-source key", async () => {
      await storage.save(createHandoff("h1"));
      await storage.save(createHandoff("h2"));
      await storage.save(createHandoff("existing-key"));

      const result = await storage.merge({
        ...baseMergeInput,
        new_key: "existing-key",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should allow new_key that is a source key when delete_sources is true", async () => {
      await storage.save(createHandoff("h1"));
      await storage.save(createHandoff("h2"));

      const result = await storage.merge({
        ...baseMergeInput,
        new_key: "h1",
        delete_sources: true,
      });
      expect(result.success).toBe(true);
      expect(result.data?.merged_key).toBe("h1");
    });

    it("should error when new_key is a source key but delete_sources is false", async () => {
      await storage.save(createHandoff("h1"));
      await storage.save(createHandoff("h2"));

      const result = await storage.merge({
        ...baseMergeInput,
        new_key: "h1",
        delete_sources: false,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should combine from_ai when sources differ", async () => {
      await storage.save(createHandoff("h1", { from_ai: "claude" }));
      await storage.save(createHandoff("h2", { from_ai: "chatgpt" }));

      const result = await storage.merge(baseMergeInput);
      expect(result.success).toBe(true);

      const diffKey = result.data?.merged_key ?? "";
      const loaded = await storage.load(diffKey);
      expect(loaded.data?.from_ai).toContain("claude");
      expect(loaded.data?.from_ai).toContain("chatgpt");
    });

    it("should use single from_ai when all sources are the same", async () => {
      await storage.save(createHandoff("h1", { from_ai: "claude" }));
      await storage.save(createHandoff("h2", { from_ai: "claude" }));

      const result = await storage.merge(baseMergeInput);
      expect(result.success).toBe(true);

      const sameKey = result.data?.merged_key ?? "";
      const loaded = await storage.load(sameKey);
      expect(loaded.data?.from_ai).toBe("claude");
    });

    it("should set metadata fields on merged handoff", async () => {
      await storage.save(createHandoff("h1", { status: "completed", next_action: "Do X" }));
      await storage.save(createHandoff("h2", { status: "pending" }));

      const result = await storage.merge(baseMergeInput);
      expect(result.success).toBe(true);

      const mergedKey = result.data?.merged_key ?? "";
      const loaded = await storage.load(mergedKey);
      expect(loaded.data?.status).toBe("active");
      expect(loaded.data?.message_count).toBeGreaterThan(0);
      expect(loaded.data?.conversation_bytes).toBeGreaterThan(0);
      expect(loaded.data && "next_action" in loaded.data).toBe(false);
    });

    it("should handle FIFO when at capacity after merge and protect source keys", async () => {
      // Fill to capacity
      for (let i = 0; i < testConfig.maxHandoffs; i++) {
        await storage.save(createHandoff(`fill-${i}`));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      // Merge two (without deleting sources) - should trigger FIFO
      const result = await storage.merge({
        keys: ["fill-0", "fill-1"],
        delete_sources: false,
        strategy: "sequential",
      });
      expect(result.success).toBe(true);

      // Should still be at max capacity
      const list = await storage.list();
      expect(list.data?.length).toBe(testConfig.maxHandoffs);

      // Source handoffs should still exist (protected from FIFO)
      const fill0 = await storage.load("fill-0");
      expect(fill0.success).toBe(true);
      const fill1 = await storage.load("fill-1");
      expect(fill1.success).toBe(true);

      // The oldest non-source handoff (fill-2) should have been deleted
      const fill2 = await storage.load("fill-2");
      expect(fill2.success).toBe(false);
    });
  });

  describe("comments", () => {
    it("should add a comment to an existing handoff", async () => {
      await storage.save(validInput);
      const result = await storage.addComment(validInput.key, "user1", "Great handoff!");
      expect(result.success).toBe(true);
      expect(result.data?.id).toMatch(/^c-\d+$/);
      expect(result.data?.author).toBe("user1");
      expect(result.data?.content).toBe("Great handoff!");
      expect(result.data?.created_at).toBeDefined();
    });

    it("should error when adding comment to non-existent handoff", async () => {
      const result = await storage.addComment("no-such-key", "user", "test");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should include comments in load response", async () => {
      await storage.save(validInput);
      await storage.addComment(validInput.key, "user1", "Comment 1");
      await storage.addComment(validInput.key, "user2", "Comment 2");

      const loaded = await storage.load(validInput.key);
      expect(loaded.success).toBe(true);
      expect(loaded.data?.comments?.length).toBe(2);
      expect(loaded.data?.comments?.[0]?.content).toBe("Comment 1");
      expect(loaded.data?.comments?.[1]?.content).toBe("Comment 2");
    });

    it("should return empty comments array when none exist", async () => {
      await storage.save(validInput);
      const loaded = await storage.load(validInput.key);
      expect(loaded.data?.comments).toEqual([]);
    });

    it("should delete a specific comment", async () => {
      await storage.save(validInput);
      const added = await storage.addComment(validInput.key, "user", "To delete");
      const commentId = added.data?.id ?? "";

      const result = await storage.deleteComment(validInput.key, commentId);
      expect(result.success).toBe(true);

      const loaded = await storage.load(validInput.key);
      expect(loaded.data?.comments?.length).toBe(0);
    });

    it("should error when deleting from non-existent handoff", async () => {
      const result = await storage.deleteComment("no-key", "c-1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should error when deleting non-existent comment", async () => {
      await storage.save(validInput);
      const result = await storage.deleteComment(validInput.key, "c-999");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should delete comments when handoff is cleared", async () => {
      await storage.save(validInput);
      await storage.addComment(validInput.key, "user", "Comment");

      await storage.clear(validInput.key);

      // Re-save and verify comments are gone
      await storage.save(validInput);
      const loaded = await storage.load(validInput.key);
      expect(loaded.data?.comments).toEqual([]);
    });

    it("should delete all comments when all handoffs are cleared", async () => {
      await storage.save(validInput);
      await storage.save({ ...validInput, key: "another" });
      await storage.addComment(validInput.key, "user", "Comment 1");
      await storage.addComment("another", "user", "Comment 2");

      await storage.clear();

      // Re-save and verify comments are gone
      await storage.save(validInput);
      const loaded = await storage.load(validInput.key);
      expect(loaded.data?.comments).toEqual([]);
    });

    it("should reject empty comment content", async () => {
      await storage.save(validInput);
      const result = await storage.addComment(validInput.key, "user", "   ");
      expect(result.success).toBe(false);
      expect(result.error).toContain("cannot be empty");
    });

    it("should reject oversized comment content", async () => {
      const limitedConfig: Config = { ...testConfig, maxCommentBytes: 100 };
      const limitedStorage = new LocalStorage(limitedConfig);
      await limitedStorage.save(validInput);

      const result = await limitedStorage.addComment(validInput.key, "user", "x".repeat(101));
      expect(result.success).toBe(false);
      expect(result.error).toContain("exceeds maximum size");
    });

    it("should reject oversized author name", async () => {
      const limitedConfig: Config = { ...testConfig, maxCommentAuthorLength: 10 };
      const limitedStorage = new LocalStorage(limitedConfig);
      await limitedStorage.save(validInput);

      const result = await limitedStorage.addComment(validInput.key, "x".repeat(11), "content");
      expect(result.success).toBe(false);
      expect(result.error).toContain("exceeds maximum length");
    });

    it("should fallback empty author to anonymous", async () => {
      await storage.save(validInput);
      const result = await storage.addComment(validInput.key, "  ", "content");
      expect(result.success).toBe(true);
      expect(result.data?.author).toBe("anonymous");
    });

    it("should enforce max comments per handoff limit", async () => {
      const limitedConfig: Config = { ...testConfig, maxCommentsPerHandoff: 3 };
      const limitedStorage = new LocalStorage(limitedConfig);
      await limitedStorage.save(validInput);

      for (let i = 0; i < 3; i++) {
        const r = await limitedStorage.addComment(validInput.key, "user", `Comment ${i}`);
        expect(r.success).toBe(true);
      }

      const result = await limitedStorage.addComment(validInput.key, "user", "Over limit");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Maximum comments");
    });

    it("should merge comments when merging handoffs", async () => {
      await storage.save({ ...validInput, key: "h1" });
      await storage.save({ ...validInput, key: "h2" });
      await storage.addComment("h1", "user1", "Comment on h1");
      await storage.addComment("h2", "user2", "Comment on h2");

      const result = await storage.merge({
        keys: ["h1", "h2"],
        delete_sources: false,
        strategy: "chronological",
      });
      expect(result.success).toBe(true);

      const mergedKey = result.data?.merged_key ?? "";
      const loaded = await storage.load(mergedKey);
      expect(loaded.data?.comments?.length).toBe(2);
      expect(loaded.data?.comments?.[0]?.content).toBe("Comment on h1");
      expect(loaded.data?.comments?.[1]?.content).toBe("Comment on h2");
    });

    it("should delete source comments when merge with delete_sources", async () => {
      await storage.save({ ...validInput, key: "h1" });
      await storage.save({ ...validInput, key: "h2" });
      await storage.addComment("h1", "user", "Comment");

      await storage.merge({
        keys: ["h1", "h2"],
        delete_sources: true,
        strategy: "chronological",
      });

      // Source handoff is deleted, so comment should be gone
      const h1 = await storage.load("h1");
      expect(h1.success).toBe(false);
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
      expect(result.error).toContain("HTTP 500");
    });
  });

  describe("auto-reconnection", () => {
    beforeEach(() => {
      resetStorageState();
    });

    afterEach(() => {
      resetStorageState();
    });

    it("should attempt reconnection on connection failure and succeed", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        // First call fails (original server down)
        if (callCount === 1) {
          return Promise.reject(new Error("ECONNREFUSED"));
        }
        // Second call is health check for port scanning - succeed
        if (url.endsWith("/")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ name: "conversation-handoff-server" }),
          });
        }
        // Third call is the retried request - succeed
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ key: "test", title: "Test" }]),
        });
      });

      // Provide reconnectFn that returns the same server URL (simulating rediscovery)
      const mockReconnect = vi.fn().mockResolvedValue("http://localhost:1099");
      const storage = new RemoteStorage("http://localhost:1099", mockReconnect);
      const result = await storage.list();

      // Should succeed after reconnection
      expect(result.success).toBe(true);
      expect(result.data).toEqual([{ key: "test", title: "Test" }]);
    });

    it("should give up after max reconnection attempts", async () => {
      // All calls fail
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      // Provide reconnectFn that always fails
      const mockReconnect = vi.fn().mockResolvedValue(null);
      const storage = new RemoteStorage("http://localhost:1099", mockReconnect);
      const result = await storage.list();

      // Should fail after exhausting retries
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to connect to server");
    });

    it("should reset reconnect attempts after successful request", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        // First request succeeds
        if (callCount <= 2) {
          if (url.endsWith("/handoff")) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve([]),
            });
          }
        }
        // Second request fails then succeeds after reconnect
        if (callCount === 3) {
          return Promise.reject(new Error("ECONNREFUSED"));
        }
        // Health check succeeds
        if (url.endsWith("/")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ name: "conversation-handoff-server" }),
          });
        }
        // Retried request succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ key: "new" }]),
        });
      });

      // Provide reconnectFn that returns the same server URL
      const mockReconnect = vi.fn().mockResolvedValue("http://localhost:1099");
      const storage = new RemoteStorage("http://localhost:1099", mockReconnect);

      // First request succeeds
      const result1 = await storage.list();
      expect(result1.success).toBe(true);

      // Second request fails then reconnects successfully
      const result2 = await storage.list();
      expect(result2.success).toBe(true);
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

  it("should return standalone mode when auto-connect fails (v0.4.0+ silent fallback)", async () => {
    // biome-ignore lint/performance/noDelete: need to clear env var for test
    delete process.env.HANDOFF_SERVER;

    // Mock fetch to simulate no server available anywhere
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    // v0.4.0+: No warnings, silent fallback
    const result = await getStorage();

    expect(result.mode).toBe("standalone");
    expect(result.storage).toBeInstanceOf(LocalStorage);
  });

  it("should return shared mode when explicit server URL is provided", async () => {
    process.env.HANDOFF_SERVER = "http://localhost:3000";

    // When explicit URL is set, it's used directly without health check
    const result = await getStorage();

    expect(result.mode).toBe("shared");
    expect(result.storage).toBeInstanceOf(RemoteStorage);
    expect(result.serverUrl).toBe("http://localhost:3000");
  });

  it("should cache auto-connect result per process", { timeout: 15000 }, async () => {
    // biome-ignore lint/performance/noDelete: need to clear env var for test
    delete process.env.HANDOFF_SERVER;

    // Mock fetch to fail initially
    const fetchMock = vi.fn().mockRejectedValue(new Error("Connection refused"));
    globalThis.fetch = fetchMock;

    // First call triggers auto-connect
    const result1 = await getStorage();
    expect(result1.mode).toBe("standalone");

    // Second call uses cached result (no additional fetch calls for auto-connect)
    const callCount = fetchMock.mock.calls.length;
    const result2 = await getStorage();
    expect(result2.mode).toBe("standalone");
    // Cache prevents new auto-connect attempts
    expect(fetchMock.mock.calls.length).toBe(callCount);
  });

  it("should preserve local storage data in standalone mode", async () => {
    // Use explicit standalone mode to avoid auto-connect overhead in tests
    // (auto-connect fallback to standalone is already tested above)
    process.env.HANDOFF_SERVER = "none";

    const result1 = await getStorage();
    await result1.storage.save({
      key: "test-key",
      title: "Test",
      summary: "Summary",
      conversation: "Conversation",
      from_ai: "claude",
      from_project: "",
    });

    // Get storage again
    const result2 = await getStorage();
    const loaded = await result2.storage.load("test-key");

    expect(loaded.success).toBe(true);
    expect(loaded.data?.title).toBe("Test");
  });
});
