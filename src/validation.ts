// =============================================================================
// Validation functions and utilities
// =============================================================================

// Re-export config types and values for backward compatibility
export type { Config, PortRange, ConnectionConfig } from "./config.js";
export { parseEnvInt, parsePortRange, defaultConfig, connectionConfig } from "./config.js";

import type { Config } from "./config.js";
import { defaultConfig } from "./config.js";

// =============================================================================
// Validation Types
// =============================================================================

/** Byte sizes calculated during validation (avoids redundant Buffer.byteLength calls) */
export interface InputSizes {
  summaryBytes?: number;
  conversationBytes?: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  /** Pre-calculated byte sizes from validation (only present when valid) */
  inputSizes?: InputSizes;
}

/** Reserved keys that conflict with API route paths */
const RESERVED_KEYS = new Set(["merge", "search"]);

// =============================================================================
// Field Validators
// =============================================================================

export function validateKey(key: string, config: Config = defaultConfig): ValidationResult {
  if (!key || key.length === 0) {
    return { valid: false, error: "Key is required" };
  }
  if (key.length > config.maxKeyLength) {
    return { valid: false, error: `Key exceeds maximum length (${config.maxKeyLength} chars)` };
  }
  if (!config.keyPattern.test(key)) {
    return {
      valid: false,
      error: "Key must contain only alphanumeric characters, hyphens, and underscores",
    };
  }
  if (RESERVED_KEYS.has(key)) {
    return { valid: false, error: `Key "${key}" is reserved and cannot be used` };
  }
  return { valid: true };
}

export function validateTitle(title: string, config: Config = defaultConfig): ValidationResult {
  if (!title || title.length === 0) {
    return { valid: false, error: "Title is required" };
  }
  if (title.length > config.maxTitleLength) {
    return { valid: false, error: `Title exceeds maximum length (${config.maxTitleLength} chars)` };
  }
  return { valid: true };
}

export function validateSummary(summary: string, config: Config = defaultConfig): ValidationResult {
  if (!summary || summary.trim().length === 0) {
    return { valid: false, error: "Summary is required" };
  }
  const summaryBytes = Buffer.byteLength(summary, "utf8");
  if (summaryBytes > config.maxSummaryBytes) {
    return {
      valid: false,
      error: `Summary exceeds maximum size (${config.maxSummaryBytes} bytes)`,
    };
  }
  return { valid: true, inputSizes: { summaryBytes } };
}

export function validateConversation(
  conversation: string,
  config: Config = defaultConfig
): ValidationResult {
  if (!conversation || conversation.trim().length === 0) {
    return { valid: false, error: "Conversation is required" };
  }
  const conversationBytes = Buffer.byteLength(conversation, "utf8");
  if (conversationBytes > config.maxConversationBytes) {
    return {
      valid: false,
      error: `Conversation exceeds maximum size (${config.maxConversationBytes} bytes)`,
    };
  }
  return { valid: true, inputSizes: { conversationBytes } };
}

export function validateHandoff(
  key: string,
  title: string,
  summary: string,
  conversation: string,
  currentCount: number,
  hasKey: boolean,
  config: Config = defaultConfig
): ValidationResult {
  const keyResult = validateKey(key, config);
  if (!keyResult.valid) return keyResult;

  const titleResult = validateTitle(title, config);
  if (!titleResult.valid) return titleResult;

  const summaryResult = validateSummary(summary, config);
  if (!summaryResult.valid) return summaryResult;

  const conversationResult = validateConversation(conversation, config);
  if (!conversationResult.valid) return conversationResult;

  // Max handoffs check (only for new keys)
  if (!hasKey && currentCount >= config.maxHandoffs) {
    return { valid: false, error: `Maximum number of handoffs reached (${config.maxHandoffs})` };
  }

  return {
    valid: true,
    inputSizes: {
      summaryBytes: summaryResult.inputSizes?.summaryBytes,
      conversationBytes: conversationResult.inputSizes?.conversationBytes,
    },
  };
}

// =============================================================================
// Comment Validation
// =============================================================================

/** Validation result for add comment input with type-safe narrowing */
export type AddCommentInputValidationResult =
  | { valid: true; data: { author: string; content: string } }
  | { valid: false; error: string };

/**
 * Validate add comment input from HTTP request body.
 * @param input - Raw input from HTTP request body
 * @returns Validation result with typed data when valid
 */
export function validateAddCommentInput(input: unknown): AddCommentInputValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, error: "Request body must be an object" };
  }

  const obj = input as Record<string, unknown>;

  // content: required string
  if (!("content" in obj)) {
    return { valid: false, error: "Missing required field: content" };
  }
  if (typeof obj.content !== "string") {
    return { valid: false, error: "Field 'content' must be a string" };
  }
  if (obj.content.trim().length === 0) {
    return { valid: false, error: "Comment content cannot be empty" };
  }

  const contentBytes = Buffer.byteLength(obj.content, "utf8");
  if (contentBytes > defaultConfig.maxCommentBytes) {
    return {
      valid: false,
      error: `Comment content exceeds maximum size (${defaultConfig.maxCommentBytes} bytes)`,
    };
  }

  // author: optional string, defaults to "anonymous"
  let author = "anonymous";
  if ("author" in obj) {
    if (typeof obj.author !== "string") {
      return { valid: false, error: "Field 'author' must be a string" };
    }
    if (obj.author.length > defaultConfig.maxCommentAuthorLength) {
      return {
        valid: false,
        error: `Author name exceeds maximum length (${defaultConfig.maxCommentAuthorLength} chars)`,
      };
    }
    if (obj.author.trim().length > 0) {
      author = obj.author;
    }
  }

  return { valid: true, data: { author, content: obj.content } };
}

// =============================================================================
// Metadata Field Validators
// =============================================================================

/** Valid handoff status values */
export const VALID_STATUSES: readonly HandoffStatus[] = ["active", "completed", "pending"] as const;

/** Validate a handoff status value */
export function validateStatus(status: string): ValidationResult {
  if (!VALID_STATUSES.includes(status as HandoffStatus)) {
    return {
      valid: false,
      error: `Invalid status: must be one of ${VALID_STATUSES.join(", ")}`,
    };
  }
  return { valid: true };
}

/** Validate the next_action field against byte size limit */
export function validateNextAction(
  nextAction: string,
  config: Config = defaultConfig
): ValidationResult {
  const bytes = Buffer.byteLength(nextAction, "utf8");
  if (bytes > config.maxNextActionBytes) {
    return {
      valid: false,
      error: `next_action exceeds maximum size (${config.maxNextActionBytes} bytes)`,
    };
  }
  return { valid: true };
}

// =============================================================================
// Tag Validation
// =============================================================================

/** Pattern for valid tag names: lowercase alphanumeric, hyphens, underscores, colons */
const TAG_PATTERN = /^[a-z0-9_:-]+$/;

/** Validate an array of tags against config limits and pattern */
export function validateTags(tags: string[], config: Config = defaultConfig): ValidationResult {
  if (tags.length > config.maxTagsPerHandoff) {
    return { valid: false, error: `Too many tags (max: ${config.maxTagsPerHandoff})` };
  }
  for (const tag of tags) {
    if (tag.length === 0) {
      return { valid: false, error: "Tags cannot be empty strings" };
    }
    if (tag.length > config.maxTagLength) {
      return {
        valid: false,
        error: `Tag "${tag}" exceeds maximum length (${config.maxTagLength} chars)`,
      };
    }
    if (!TAG_PATTERN.test(tag)) {
      return {
        valid: false,
        error: `Tag "${tag}" contains invalid characters (allowed: lowercase alphanumeric, hyphens, underscores, colons)`,
      };
    }
  }
  return { valid: true };
}

/** Normalize tags to lowercase */
export function normalizeTags(tags: string[]): string[] {
  return tags.map((t) => t.toLowerCase());
}

// =============================================================================
// HTTP API Input Validation
// =============================================================================

import type { HandoffStatus, MergeInput, SaveInput, SearchInput } from "./types.js";

/** Validation result for save input with type-safe narrowing */
export type SaveInputValidationResult =
  | { valid: true; data: SaveInput }
  | { valid: false; error: string };

/** Validation result for merge input with type-safe narrowing */
export type MergeInputValidationResult =
  | { valid: true; data: MergeInput }
  | { valid: false; error: string };

/**
 * @deprecated Use SaveInputValidationResult instead for type-safe narrowing
 */
export type SaveInputValidation = SaveInputValidationResult;

/**
 * Validate HTTP API save input.
 * Checks required fields and their types.
 * @param input - Raw input from HTTP request body
 * @returns Validation result with typed data when valid
 */
export function validateSaveInput(input: unknown): SaveInputValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, error: "Request body must be an object" };
  }

  const obj = input as Record<string, unknown>;

  // Required string fields
  const requiredFields = ["key", "title", "summary", "conversation", "from_ai", "from_project"];
  for (const field of requiredFields) {
    if (!(field in obj)) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
    if (typeof obj[field] !== "string") {
      return { valid: false, error: `Field '${field}' must be a string` };
    }
  }

  // Optional metadata fields
  if ("message_count" in obj) {
    if (
      typeof obj.message_count !== "number" ||
      !Number.isInteger(obj.message_count) ||
      obj.message_count < 0
    ) {
      return { valid: false, error: "Field 'message_count' must be a non-negative integer" };
    }
  }

  if ("conversation_bytes" in obj) {
    if (
      typeof obj.conversation_bytes !== "number" ||
      !Number.isInteger(obj.conversation_bytes) ||
      obj.conversation_bytes < 0
    ) {
      return { valid: false, error: "Field 'conversation_bytes' must be a non-negative integer" };
    }
  }

  if ("status" in obj) {
    if (typeof obj.status !== "string") {
      return { valid: false, error: "Field 'status' must be a string" };
    }
    const statusResult = validateStatus(obj.status);
    if (!statusResult.valid) {
      return { valid: false, error: statusResult.error ?? "Invalid status" };
    }
  }

  if ("next_action" in obj) {
    if (typeof obj.next_action !== "string") {
      return { valid: false, error: "Field 'next_action' must be a string" };
    }
    const nextActionResult = validateNextAction(obj.next_action);
    if (!nextActionResult.valid) {
      return { valid: false, error: nextActionResult.error ?? "Invalid next_action" };
    }
  }

  if ("tags" in obj) {
    if (!Array.isArray(obj.tags)) {
      return { valid: false, error: "Field 'tags' must be an array" };
    }
    for (const tag of obj.tags) {
      if (typeof tag !== "string") {
        return { valid: false, error: "Each element in 'tags' must be a string" };
      }
    }
    const normalized = normalizeTags(obj.tags as string[]);
    const tagsResult = validateTags(normalized);
    if (!tagsResult.valid) {
      return { valid: false, error: tagsResult.error ?? "Invalid tags" };
    }
    // Replace with normalized tags in the data
    obj.tags = normalized;
  }

  return { valid: true, data: obj as unknown as SaveInput };
}

/** Valid merge strategy types */
export type MergeStrategy = "chronological" | "sequential";

/** Valid merge strategies as a constant array for runtime validation */
const VALID_MERGE_STRATEGIES: readonly MergeStrategy[] = ["chronological", "sequential"] as const;

/**
 * Validate HTTP API merge input.
 * Checks required fields, types, key validity, and duplicate detection.
 * @param input - Raw input from HTTP request body
 * @returns Validation result with typed data when valid
 */
export function validateMergeInput(input: unknown): MergeInputValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, error: "Request body must be an object" };
  }

  const obj = input as Record<string, unknown>;

  // keys: required, string[], 2+ elements, each valid
  if (!("keys" in obj)) {
    return { valid: false, error: "Missing required field: keys" };
  }
  if (!Array.isArray(obj.keys)) {
    return { valid: false, error: "Field 'keys' must be an array" };
  }
  if (obj.keys.length < 2) {
    return { valid: false, error: "Field 'keys' must have at least 2 elements" };
  }
  for (const key of obj.keys) {
    if (typeof key !== "string") {
      return { valid: false, error: "Each element in 'keys' must be a string" };
    }
    const keyResult = validateKey(key);
    if (!keyResult.valid) {
      return { valid: false, error: `Invalid key '${key}': ${keyResult.error}` };
    }
  }

  // Duplicate key detection
  const uniqueKeys = new Set(obj.keys as string[]);
  if (uniqueKeys.size !== obj.keys.length) {
    return { valid: false, error: "Duplicate keys are not allowed" };
  }

  // strategy: required, must be valid value
  if (!("strategy" in obj)) {
    return { valid: false, error: "Missing required field: strategy" };
  }
  if (
    typeof obj.strategy !== "string" ||
    !VALID_MERGE_STRATEGIES.includes(obj.strategy as MergeStrategy)
  ) {
    return {
      valid: false,
      error: `Field 'strategy' must be one of: ${VALID_MERGE_STRATEGIES.join(", ")}`,
    };
  }

  // delete_sources: required, boolean
  if (!("delete_sources" in obj)) {
    return { valid: false, error: "Missing required field: delete_sources" };
  }
  if (typeof obj.delete_sources !== "boolean") {
    return { valid: false, error: "Field 'delete_sources' must be a boolean" };
  }

  // Optional string fields
  const optionalStringFields = ["new_key", "new_title", "new_summary"];
  for (const field of optionalStringFields) {
    if (field in obj && typeof obj[field] !== "string") {
      return { valid: false, error: `Field '${field}' must be a string` };
    }
  }

  return { valid: true, data: obj as unknown as MergeInput };
}

// =============================================================================
// Search Input Validation
// =============================================================================

/** Validation result for search input with type-safe narrowing */
export type SearchInputValidationResult =
  | { valid: true; data: SearchInput }
  | { valid: false; error: string };

/**
 * Validate HTTP API search input.
 * @param input - Raw input from HTTP request body
 * @returns Validation result with typed data when valid
 */
export function validateSearchInput(input: unknown): SearchInputValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, error: "Request body must be an object" };
  }

  const obj = input as Record<string, unknown>;

  // Validate tags and tags_all (optional string arrays, same rules as save)
  for (const field of ["tags", "tags_all"] as const) {
    if (field in obj) {
      if (!Array.isArray(obj[field])) {
        return { valid: false, error: `Field '${field}' must be an array` };
      }
      for (const tag of obj[field] as unknown[]) {
        if (typeof tag !== "string") {
          return { valid: false, error: `Each element in '${field}' must be a string` };
        }
      }
      // Normalize and validate tags (same constraints as save)
      const normalized = normalizeTags(obj[field] as string[]);
      const tagsResult = validateTags(normalized);
      if (!tagsResult.valid) {
        return { valid: false, error: tagsResult.error ?? "Invalid tags" };
      }
      obj[field] = normalized;
    }
  }

  // Validate optional string fields
  for (const field of ["query", "from_project", "from_ai"]) {
    if (field in obj && typeof obj[field] !== "string") {
      return { valid: false, error: `Field '${field}' must be a string` };
    }
  }

  // Validate ISO date fields (must be parseable as Date and produce valid ISO strings)
  for (const field of ["created_after", "created_before"]) {
    if (field in obj) {
      if (typeof obj[field] !== "string") {
        return { valid: false, error: `Field '${field}' must be a string` };
      }
      const date = new Date(obj[field] as string);
      if (Number.isNaN(date.getTime())) {
        return { valid: false, error: `Field '${field}' must be a valid ISO date string` };
      }
    }
  }

  // Validate status if present
  if ("status" in obj) {
    if (typeof obj.status !== "string") {
      return { valid: false, error: "Field 'status' must be a string" };
    }
    const statusResult = validateStatus(obj.status);
    if (!statusResult.valid) {
      return { valid: false, error: statusResult.error ?? "Invalid status" };
    }
  }

  // Validate limit if present
  if ("limit" in obj) {
    if (typeof obj.limit !== "number" || !Number.isInteger(obj.limit) || obj.limit < 1) {
      return { valid: false, error: "Field 'limit' must be a positive integer" };
    }
    if (obj.limit > 100) {
      return { valid: false, error: "Field 'limit' must not exceed 100" };
    }
  }

  return { valid: true, data: obj as unknown as SearchInput };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Sleep for specified milliseconds.
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Generate a compact timestamp string (YYYYMMDDHHMMSS) from a Date */
export function compactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/** Format byte count to human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

/**
 * Common conversation delimiter patterns for splitting messages.
 * Supports various formats that AIs might use:
 * - ## User / ## Assistant (Markdown H2) - recommended
 * - # User / # Assistant (Markdown H1)
 * - ### User / ### Assistant (Markdown H3)
 * - **User:** / **Assistant:** (Bold with colon)
 * - User: / Assistant: (Simple colon format)
 * Also supports alternative role names: Human, Claude, AI
 */
const MESSAGE_DELIMITER =
  /(?=(?:^|\n)(?:#{1,3}\s+|\*\*)?(?:User|Assistant|Human|Claude|AI)(?:\*\*)?(?::|(?=\s*\n)))/i;

/**
 * Split a conversation string into individual messages.
 * Handles various common formats used by different AIs.
 * @param conversation - The conversation text to split
 * @returns Array of message strings
 */
export function splitConversationMessages(conversation: string): string[] {
  const messages = conversation.split(MESSAGE_DELIMITER).filter((msg) => msg.trim().length > 0);

  // If no delimiters found, return the whole conversation as one message
  if (messages.length === 0) {
    return [conversation];
  }

  return messages;
}
