// =============================================================================
// Configuration
// =============================================================================

export interface Config {
  maxHandoffs: number;
  maxConversationBytes: number;
  maxSummaryBytes: number;
  maxTitleLength: number;
  maxKeyLength: number;
  keyPattern: RegExp;
}

export interface PortRange {
  start: number;
  end: number;
}

export interface ConnectionConfig {
  portRange: PortRange;
  retryCount: number;
  retryIntervalMs: number;
  /** Server TTL in ms (0 = disabled). Server shuts down after this time of inactivity. */
  serverTtlMs: number;
  /** Fetch timeout in ms for HTTP requests */
  fetchTimeoutMs: number;
}

/**
 * Safely parse an integer from environment variable with fallback.
 * Returns the default value if the env var is missing, empty, or invalid.
 */
function parseEnvInt(envVar: string | undefined, defaultValue: number, min = 1): number {
  if (!envVar) {
    return defaultValue;
  }
  const parsed = Number.parseInt(envVar, 10);
  if (Number.isNaN(parsed) || parsed < min) {
    console.warn(
      `[conversation-handoff] Invalid config value "${envVar}", using default: ${defaultValue}`
    );
    return defaultValue;
  }
  return parsed;
}

export const defaultConfig: Config = {
  maxHandoffs: parseEnvInt(process.env.HANDOFF_MAX_COUNT, 100),
  maxConversationBytes: parseEnvInt(process.env.HANDOFF_MAX_CONVERSATION_BYTES, 1024 * 1024),
  maxSummaryBytes: parseEnvInt(process.env.HANDOFF_MAX_SUMMARY_BYTES, 10 * 1024),
  maxTitleLength: parseEnvInt(process.env.HANDOFF_MAX_TITLE_LENGTH, 200),
  maxKeyLength: parseEnvInt(process.env.HANDOFF_MAX_KEY_LENGTH, 100),
  keyPattern: /^[a-zA-Z0-9_-]+$/,
};

// =============================================================================
// Validation
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Reserved keys that conflict with API route paths */
const RESERVED_KEYS = new Set(["merge"]);

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
  const summaryBytes = Buffer.byteLength(summary, "utf8");
  if (summaryBytes > config.maxSummaryBytes) {
    return {
      valid: false,
      error: `Summary exceeds maximum size (${config.maxSummaryBytes} bytes)`,
    };
  }
  return { valid: true };
}

export function validateConversation(
  conversation: string,
  config: Config = defaultConfig
): ValidationResult {
  const conversationBytes = Buffer.byteLength(conversation, "utf8");
  if (conversationBytes > config.maxConversationBytes) {
    return {
      valid: false,
      error: `Conversation exceeds maximum size (${config.maxConversationBytes} bytes)`,
    };
  }
  return { valid: true };
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

  return { valid: true };
}

// =============================================================================
// HTTP API Input Validation
// =============================================================================

export interface SaveInputValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate HTTP API save input.
 * Checks required fields and their types.
 * @param input - Raw input from HTTP request body
 * @returns Validation result with error message if invalid
 */
export function validateSaveInput(input: unknown): SaveInputValidation {
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

  return { valid: true };
}

/** Valid merge strategy types */
export type MergeStrategy = "chronological" | "sequential";

/** Valid merge strategies as a constant array for runtime validation */
const VALID_MERGE_STRATEGIES: readonly MergeStrategy[] = ["chronological", "sequential"] as const;

/**
 * Validate HTTP API merge input.
 * Checks required fields, types, key validity, and duplicate detection.
 * @param input - Raw input from HTTP request body
 * @returns Validation result with error message if invalid
 */
export function validateMergeInput(input: unknown): SaveInputValidation {
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

  return { valid: true };
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
  /(?=(?:^|\n)(?:#{1,3}\s+|\*\*)?(?:User|Assistant|Human|Claude|AI)(?:\*\*)?(?::|(?=\s*\n)))/gi;

/**
 * Split a conversation string into individual messages.
 * Handles various common formats used by different AIs.
 * @param conversation - The conversation text to split
 * @returns Array of message strings
 */
export function splitConversationMessages(conversation: string): string[] {
  // Reset regex state (global flag)
  MESSAGE_DELIMITER.lastIndex = 0;

  const messages = conversation.split(MESSAGE_DELIMITER).filter((msg) => msg.trim().length > 0);

  // If no delimiters found, return the whole conversation as one message
  if (messages.length === 0) {
    return [conversation];
  }

  return messages;
}

// =============================================================================
// Connection Configuration
// =============================================================================

/**
 * Parse port range from environment variable (format: "start-end")
 */
function parsePortRange(envVar: string | undefined, defaultRange: PortRange): PortRange {
  if (!envVar) {
    return defaultRange;
  }
  const match = envVar.match(/^(\d+)-(\d+)$/);
  if (!match || !match[1] || !match[2]) {
    console.warn(
      `[conversation-handoff] Invalid port range "${envVar}", using default: ${defaultRange.start}-${defaultRange.end}`
    );
    return defaultRange;
  }
  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);
  if (start < 1 || start > 65535 || end < 1 || end > 65535 || start > end) {
    console.warn(
      `[conversation-handoff] Invalid port range "${envVar}", using default: ${defaultRange.start}-${defaultRange.end}`
    );
    return defaultRange;
  }
  return { start, end };
}

export const connectionConfig: ConnectionConfig = {
  portRange: parsePortRange(process.env.HANDOFF_PORT_RANGE, { start: 1099, end: 1200 }),
  retryCount: parseEnvInt(process.env.HANDOFF_RETRY_COUNT, 30),
  retryIntervalMs: parseEnvInt(process.env.HANDOFF_RETRY_INTERVAL, 10000),
  serverTtlMs: parseEnvInt(process.env.HANDOFF_SERVER_TTL, 24 * 60 * 60 * 1000, 0), // Default: 24 hours, min: 0 (disabled)
  fetchTimeoutMs: parseEnvInt(process.env.HANDOFF_FETCH_TIMEOUT, 30 * 1000), // Default: 30 seconds
};
