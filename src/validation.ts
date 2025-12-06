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
// Utilities
// =============================================================================

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}
