import { describe, expect, it } from "vitest";
import {
  type Config,
  VALID_STATUSES,
  formatBytes,
  normalizeTags,
  splitConversationMessages,
  validateAddCommentInput,
  validateConversation,
  validateHandoff,
  validateKey,
  validateMergeInput,
  validateNextAction,
  validateSaveInput,
  validateSearchInput,
  validateStatus,
  validateSummary,
  validateTags,
  validateTitle,
} from "./validation.js";

const testConfig: Config = {
  maxHandoffs: 10,
  maxConversationBytes: 1000,
  maxSummaryBytes: 100,
  maxTitleLength: 50,
  maxKeyLength: 20,
  keyPattern: /^[a-zA-Z0-9_-]+$/,
  maxCommentBytes: 10000,
  maxCommentsPerHandoff: 50,
  maxCommentAuthorLength: 100,
  maxNextActionBytes: 2048,
  maxTagsPerHandoff: 20,
  maxTagLength: 50,
};

describe("validateKey", () => {
  it("should reject empty key", () => {
    const result = validateKey("", testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Key is required");
  });

  it("should reject key that is too long", () => {
    const result = validateKey("a".repeat(21), testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum length");
  });

  it("should reject key with invalid characters", () => {
    const result = validateKey("invalid key!", testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("alphanumeric");
  });

  it("should accept valid key", () => {
    expect(validateKey("valid-key_123", testConfig).valid).toBe(true);
  });

  it("should reject reserved key 'merge'", () => {
    const result = validateKey("merge", testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("reserved");
  });
});

describe("validateTitle", () => {
  it("should reject empty title", () => {
    const result = validateTitle("", testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Title is required");
  });

  it("should reject title that is too long", () => {
    const result = validateTitle("a".repeat(51), testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum length");
  });

  it("should accept valid title", () => {
    expect(validateTitle("Valid Title", testConfig).valid).toBe(true);
  });
});

describe("validateSummary", () => {
  it("should reject empty summary", () => {
    const result = validateSummary("", testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Summary is required");
  });

  it("should reject whitespace-only summary", () => {
    const result = validateSummary("   \n\t  ", testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Summary is required");
  });

  it("should reject summary that is too large", () => {
    const result = validateSummary("a".repeat(101), testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum size");
  });

  it("should accept valid summary", () => {
    const result = validateSummary("Short summary", testConfig);
    expect(result.valid).toBe(true);
    expect(result.inputSizes?.summaryBytes).toBe(Buffer.byteLength("Short summary", "utf8"));
  });

  it("should handle multibyte characters correctly", () => {
    // Japanese characters are 3 bytes each in UTF-8
    const japaneseText = "あ".repeat(34); // 34 * 3 = 102 bytes > 100
    const result = validateSummary(japaneseText, testConfig);
    expect(result.valid).toBe(false);
  });
});

describe("validateConversation", () => {
  it("should reject empty conversation", () => {
    const result = validateConversation("", testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Conversation is required");
  });

  it("should reject whitespace-only conversation", () => {
    const result = validateConversation("   \n\t  ", testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Conversation is required");
  });

  it("should reject conversation that is too large", () => {
    const result = validateConversation("a".repeat(1001), testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum size");
  });

  it("should accept valid conversation", () => {
    const conv = "## User\nHello\n\n## Assistant\nHi!";
    const result = validateConversation(conv, testConfig);
    expect(result.valid).toBe(true);
    expect(result.inputSizes?.conversationBytes).toBe(Buffer.byteLength(conv, "utf8"));
  });
});

describe("validateHandoff", () => {
  it("should reject when max handoffs reached", () => {
    const result = validateHandoff(
      "key",
      "title",
      "summary",
      "conversation",
      10,
      false,
      testConfig
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Maximum number of handoffs reached");
  });

  it("should allow update of existing key even at max", () => {
    const result = validateHandoff("key", "title", "summary", "conversation", 10, true, testConfig);
    expect(result.valid).toBe(true);
  });

  it("should validate all fields", () => {
    // Invalid key
    expect(validateHandoff("", "title", "summary", "conv", 0, false, testConfig).valid).toBe(false);

    // Invalid title
    expect(validateHandoff("key", "", "summary", "conv", 0, false, testConfig).valid).toBe(false);

    // Valid — should include inputSizes
    const validResult = validateHandoff("key", "title", "summary", "conv", 0, false, testConfig);
    expect(validResult.valid).toBe(true);
    expect(validResult.inputSizes?.summaryBytes).toBe(Buffer.byteLength("summary", "utf8"));
    expect(validResult.inputSizes?.conversationBytes).toBe(Buffer.byteLength("conv", "utf8"));
  });
});

describe("formatBytes", () => {
  it("should format 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("should format bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("should format kilobytes", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("should format megabytes", () => {
    expect(formatBytes(1048576)).toBe("1 MB");
  });

  it("should format gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1 GB");
  });
});

describe("splitConversationMessages", () => {
  it("should split ## User / ## Assistant format (recommended)", () => {
    const conversation = "## User\nHello\n\n## Assistant\nHi there!";
    const messages = splitConversationMessages(conversation);
    expect(messages.length).toBe(2);
    expect(messages[0]).toContain("User");
    expect(messages[1]).toContain("Assistant");
  });

  it("should split # User / # Assistant format (H1)", () => {
    const conversation = "# User\nHello\n\n# Assistant\nHi there!";
    const messages = splitConversationMessages(conversation);
    expect(messages.length).toBe(2);
  });

  it("should split ### User / ### Assistant format (H3)", () => {
    const conversation = "### User\nHello\n\n### Assistant\nHi there!";
    const messages = splitConversationMessages(conversation);
    expect(messages.length).toBe(2);
  });

  it("should split **User:** / **Assistant:** format (bold)", () => {
    const conversation = "**User:**\nHello\n\n**Assistant:**\nHi there!";
    const messages = splitConversationMessages(conversation);
    expect(messages.length).toBe(2);
  });

  it("should split User: / Assistant: format (simple colon)", () => {
    const conversation = "User:\nHello\n\nAssistant:\nHi there!";
    const messages = splitConversationMessages(conversation);
    expect(messages.length).toBe(2);
  });

  it("should split Human: / Claude: format (alternative names)", () => {
    const conversation = "Human:\nHello\n\nClaude:\nHi there!";
    const messages = splitConversationMessages(conversation);
    expect(messages.length).toBe(2);
  });

  it("should split Human: / AI: format", () => {
    const conversation = "Human:\nHello\n\nAI:\nHi there!";
    const messages = splitConversationMessages(conversation);
    expect(messages.length).toBe(2);
  });

  it("should handle multiple messages", () => {
    const conversation = `## User
First question

## Assistant
First answer

## User
Second question

## Assistant
Second answer`;
    const messages = splitConversationMessages(conversation);
    expect(messages.length).toBe(4);
  });

  it("should return whole conversation if no delimiters found", () => {
    const conversation = "Just some plain text without any message delimiters.";
    const messages = splitConversationMessages(conversation);
    expect(messages.length).toBe(1);
    expect(messages[0]).toBe(conversation);
  });

  it("should handle empty string", () => {
    const messages = splitConversationMessages("");
    expect(messages.length).toBe(1);
  });

  it("should be case-insensitive for role names", () => {
    const conversation = "## user\nHello\n\n## assistant\nHi there!";
    const messages = splitConversationMessages(conversation);
    expect(messages.length).toBe(2);
  });
});

describe("validateStatus", () => {
  it("should accept valid statuses", () => {
    for (const status of VALID_STATUSES) {
      expect(validateStatus(status).valid).toBe(true);
    }
  });

  it("should reject invalid status", () => {
    const result = validateStatus("unknown");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid status");
  });
});

describe("validateNextAction", () => {
  it("should accept valid next_action", () => {
    expect(validateNextAction("Run tests", testConfig).valid).toBe(true);
  });

  it("should reject oversized next_action", () => {
    const result = validateNextAction("x".repeat(2049), testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum size");
  });

  it("should accept next_action at exact limit", () => {
    expect(validateNextAction("x".repeat(2048), testConfig).valid).toBe(true);
  });
});

describe("validateSaveInput", () => {
  const validInput = {
    key: "test-key",
    title: "Test Title",
    summary: "Test summary",
    conversation: "Test conversation",
    from_ai: "claude",
    from_project: "test-project",
  };

  it("should accept valid input", () => {
    const result = validateSaveInput(validInput);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should reject null", () => {
    const result = validateSaveInput(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Request body must be an object");
  });

  it("should reject array", () => {
    const result = validateSaveInput([]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Request body must be an object");
  });

  it("should reject primitive types", () => {
    expect(validateSaveInput("string").valid).toBe(false);
    expect(validateSaveInput(123).valid).toBe(false);
    expect(validateSaveInput(undefined).valid).toBe(false);
  });

  it("should reject missing required fields", () => {
    const fields = ["key", "title", "summary", "conversation", "from_ai", "from_project"];
    for (const field of fields) {
      const input = { ...validInput };
      delete (input as Record<string, unknown>)[field];
      const result = validateSaveInput(input);
      expect(result.valid).toBe(false);
      expect(result.error).toBe(`Missing required field: ${field}`);
    }
  });

  it("should reject non-string fields", () => {
    const fields = ["key", "title", "summary", "conversation", "from_ai", "from_project"];
    for (const field of fields) {
      const input = { ...validInput, [field]: 123 };
      const result = validateSaveInput(input);
      expect(result.valid).toBe(false);
      expect(result.error).toBe(`Field '${field}' must be a string`);
    }
  });

  it("should allow empty string for from_project", () => {
    const input = { ...validInput, from_project: "" };
    const result = validateSaveInput(input);
    expect(result.valid).toBe(true);
  });

  it("should accept valid optional metadata fields", () => {
    const input = {
      ...validInput,
      message_count: 5,
      conversation_bytes: 1000,
      status: "completed",
      next_action: "Deploy to production",
    };
    const result = validateSaveInput(input);
    expect(result.valid).toBe(true);
  });

  it("should reject non-integer message_count", () => {
    expect(validateSaveInput({ ...validInput, message_count: 1.5 }).valid).toBe(false);
    expect(validateSaveInput({ ...validInput, message_count: "5" }).valid).toBe(false);
  });

  it("should reject negative message_count", () => {
    const result = validateSaveInput({ ...validInput, message_count: -1 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("non-negative integer");
  });

  it("should reject non-integer conversation_bytes", () => {
    expect(validateSaveInput({ ...validInput, conversation_bytes: 1.5 }).valid).toBe(false);
    expect(validateSaveInput({ ...validInput, conversation_bytes: "100" }).valid).toBe(false);
  });

  it("should reject negative conversation_bytes", () => {
    const result = validateSaveInput({ ...validInput, conversation_bytes: -1 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("non-negative integer");
  });

  it("should reject invalid status", () => {
    const result = validateSaveInput({ ...validInput, status: "unknown" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid status");
  });

  it("should reject non-string status", () => {
    const result = validateSaveInput({ ...validInput, status: 123 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must be a string");
  });

  it("should reject non-string next_action", () => {
    const result = validateSaveInput({ ...validInput, next_action: 123 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must be a string");
  });

  it("should accept valid tags", () => {
    const result = validateSaveInput({ ...validInput, tags: ["auth", "project:foo"] });
    expect(result.valid).toBe(true);
  });

  it("should reject non-array tags", () => {
    const result = validateSaveInput({ ...validInput, tags: "auth" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must be an array");
  });

  it("should reject tags with non-string elements", () => {
    const result = validateSaveInput({ ...validInput, tags: ["auth", 123] });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must be a string");
  });

  it("should normalize tags to lowercase in validateSaveInput", () => {
    const input = { ...validInput, tags: ["Auth", "PROJECT:FOO"] };
    const result = validateSaveInput(input);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.tags).toEqual(["auth", "project:foo"]);
    }
  });
});

describe("validateMergeInput", () => {
  const validMergeInput = {
    keys: ["key-1", "key-2"],
    strategy: "chronological",
    delete_sources: false,
  };

  it("should accept valid minimal input", () => {
    const result = validateMergeInput(validMergeInput);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should accept valid input with all optional fields", () => {
    const result = validateMergeInput({
      ...validMergeInput,
      new_key: "merged-key",
      new_title: "Merged Title",
      new_summary: "Merged summary",
    });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should reject non-object input", () => {
    expect(validateMergeInput(null).valid).toBe(false);
    expect(validateMergeInput([]).valid).toBe(false);
    expect(validateMergeInput("string").valid).toBe(false);
    expect(validateMergeInput(123).valid).toBe(false);
  });

  it("should reject keys that is not an array", () => {
    const result = validateMergeInput({ ...validMergeInput, keys: "not-array" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Field 'keys' must be an array");
  });

  it("should reject keys with only 1 element", () => {
    const result = validateMergeInput({ ...validMergeInput, keys: ["only-one"] });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Field 'keys' must have at least 2 elements");
  });

  it("should reject keys with non-string elements", () => {
    const result = validateMergeInput({ ...validMergeInput, keys: ["valid", 123] });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Each element in 'keys' must be a string");
  });

  it("should reject keys with invalid key format", () => {
    const result = validateMergeInput({ ...validMergeInput, keys: ["valid-key", "invalid key!"] });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid key");
  });

  it("should reject duplicate keys", () => {
    const result = validateMergeInput({ ...validMergeInput, keys: ["same-key", "same-key"] });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Duplicate keys are not allowed");
  });

  it("should reject invalid strategy value", () => {
    const result = validateMergeInput({ ...validMergeInput, strategy: "invalid" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Field 'strategy' must be one of");
  });

  it("should reject non-boolean delete_sources", () => {
    const result = validateMergeInput({ ...validMergeInput, delete_sources: "true" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Field 'delete_sources' must be a boolean");
  });

  it("should reject non-string new_key", () => {
    const result = validateMergeInput({ ...validMergeInput, new_key: 123 });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Field 'new_key' must be a string");
  });
});

describe("validateAddCommentInput", () => {
  it("should accept valid input with content only", () => {
    const result = validateAddCommentInput({ content: "A comment" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.content).toBe("A comment");
      expect(result.data.author).toBe("anonymous");
    }
  });

  it("should accept valid input with author", () => {
    const result = validateAddCommentInput({ content: "A comment", author: "user1" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.author).toBe("user1");
    }
  });

  it("should default to anonymous for empty author", () => {
    const result = validateAddCommentInput({ content: "A comment", author: "  " });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.author).toBe("anonymous");
    }
  });

  it("should reject non-object input", () => {
    expect(validateAddCommentInput(null).valid).toBe(false);
    expect(validateAddCommentInput([]).valid).toBe(false);
    expect(validateAddCommentInput("string").valid).toBe(false);
  });

  it("should reject missing content", () => {
    const result = validateAddCommentInput({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Missing required field: content");
    }
  });

  it("should reject non-string content", () => {
    const result = validateAddCommentInput({ content: 123 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Field 'content' must be a string");
    }
  });

  it("should reject empty content", () => {
    const result = validateAddCommentInput({ content: "  " });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Comment content cannot be empty");
    }
  });

  it("should reject non-string author", () => {
    const result = validateAddCommentInput({ content: "text", author: 123 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Field 'author' must be a string");
    }
  });

  it("should reject oversized content", () => {
    const result = validateAddCommentInput({ content: "x".repeat(10001) });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("exceeds maximum size");
    }
  });

  it("should reject oversized author", () => {
    const result = validateAddCommentInput({ content: "text", author: "x".repeat(101) });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("exceeds maximum length");
    }
  });
});

describe("validateTags", () => {
  it("should accept valid tags", () => {
    expect(validateTags(["auth", "project:foo", "issue-176"], testConfig).valid).toBe(true);
  });

  it("should accept tags with colons, hyphens, underscores", () => {
    expect(validateTags(["my_tag", "ns:value", "a-b-c"], testConfig).valid).toBe(true);
  });

  it("should reject empty tag string", () => {
    const result = validateTags(["valid", ""], testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("cannot be empty");
  });

  it("should reject tag with invalid characters", () => {
    const result = validateTags(["has spaces"], testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("invalid characters");
  });

  it("should reject uppercase tags (must be pre-normalized)", () => {
    const result = validateTags(["UpperCase"], testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("invalid characters");
  });

  it("should reject tag exceeding max length", () => {
    const longTag = "a".repeat(51);
    const result = validateTags([longTag], testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum length");
  });

  it("should reject too many tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    const result = validateTags(tags, testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Too many tags");
  });

  it("should accept at exact limit", () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    expect(validateTags(tags, testConfig).valid).toBe(true);
  });
});

describe("normalizeTags", () => {
  it("should lowercase all tags", () => {
    expect(normalizeTags(["Auth", "PROJECT:FOO", "deploy"])).toEqual([
      "auth",
      "project:foo",
      "deploy",
    ]);
  });

  it("should return empty array for empty input", () => {
    expect(normalizeTags([])).toEqual([]);
  });
});

describe("validateSearchInput", () => {
  it("should accept empty object", () => {
    const result = validateSearchInput({});
    expect(result.valid).toBe(true);
  });

  it("should accept valid search with all fields", () => {
    const result = validateSearchInput({
      tags: ["auth"],
      tags_all: ["project:foo", "deploy"],
      query: "refactor",
      from_project: "my-project",
      from_ai: "claude",
      status: "active",
      created_after: "2026-01-01T00:00:00Z",
      created_before: "2026-12-31T23:59:59Z",
      limit: 50,
    });
    expect(result.valid).toBe(true);
  });

  it("should normalize tags to lowercase", () => {
    const result = validateSearchInput({ tags: ["Auth", "DEPLOY"] });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.tags).toEqual(["auth", "deploy"]);
    }
  });

  it("should normalize tags_all to lowercase", () => {
    const result = validateSearchInput({ tags_all: ["Auth"] });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.tags_all).toEqual(["auth"]);
    }
  });

  it("should reject non-object input", () => {
    expect(validateSearchInput(null).valid).toBe(false);
    expect(validateSearchInput([]).valid).toBe(false);
    expect(validateSearchInput("string").valid).toBe(false);
  });

  it("should reject non-array tags", () => {
    const result = validateSearchInput({ tags: "auth" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must be an array");
  });

  it("should reject non-string elements in tags", () => {
    const result = validateSearchInput({ tags: [123] });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must be a string");
  });

  it("should reject non-string query", () => {
    const result = validateSearchInput({ query: 123 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must be a string");
  });

  it("should reject invalid status", () => {
    const result = validateSearchInput({ status: "unknown" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid status");
  });

  it("should reject non-string status", () => {
    const result = validateSearchInput({ status: 123 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must be a string");
  });

  it("should reject non-integer limit", () => {
    const result = validateSearchInput({ limit: 1.5 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("positive integer");
  });

  it("should reject limit less than 1", () => {
    const result = validateSearchInput({ limit: 0 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("positive integer");
  });

  it("should reject limit greater than 100", () => {
    const result = validateSearchInput({ limit: 101 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must not exceed 100");
  });
});

describe("validateKey - reserved keys", () => {
  it("should reject reserved key 'search'", () => {
    const result = validateKey("search");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("reserved");
  });
});
