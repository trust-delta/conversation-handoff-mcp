import { describe, expect, it } from "vitest";
import {
  type Config,
  formatBytes,
  splitConversationMessages,
  validateConversation,
  validateHandoff,
  validateKey,
  validateMergeInput,
  validateSaveInput,
  validateSummary,
  validateTitle,
} from "./validation.js";

const testConfig: Config = {
  maxHandoffs: 10,
  maxConversationBytes: 1000,
  maxSummaryBytes: 100,
  maxTitleLength: 50,
  maxKeyLength: 20,
  keyPattern: /^[a-zA-Z0-9_-]+$/,
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
  it("should reject summary that is too large", () => {
    const result = validateSummary("a".repeat(101), testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum size");
  });

  it("should accept valid summary", () => {
    expect(validateSummary("Short summary", testConfig).valid).toBe(true);
  });

  it("should handle multibyte characters correctly", () => {
    // Japanese characters are 3 bytes each in UTF-8
    const japaneseText = "あ".repeat(34); // 34 * 3 = 102 bytes > 100
    const result = validateSummary(japaneseText, testConfig);
    expect(result.valid).toBe(false);
  });
});

describe("validateConversation", () => {
  it("should reject conversation that is too large", () => {
    const result = validateConversation("a".repeat(1001), testConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum size");
  });

  it("should accept valid conversation", () => {
    expect(validateConversation("## User\nHello\n\n## Assistant\nHi!", testConfig).valid).toBe(
      true
    );
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

    // Valid
    expect(validateHandoff("key", "title", "summary", "conv", 0, false, testConfig).valid).toBe(
      true
    );
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
