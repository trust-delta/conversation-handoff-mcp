// =============================================================================
// Configuration types and environment variable parsing
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
export function parseEnvInt(envVar: string | undefined, defaultValue: number, min = 1): number {
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

/**
 * Parse port range from environment variable (format: "start-end")
 */
export function parsePortRange(envVar: string | undefined, defaultRange: PortRange): PortRange {
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

export const defaultConfig: Config = {
  maxHandoffs: parseEnvInt(process.env.HANDOFF_MAX_COUNT, 100),
  maxConversationBytes: parseEnvInt(process.env.HANDOFF_MAX_CONVERSATION_BYTES, 1024 * 1024),
  maxSummaryBytes: parseEnvInt(process.env.HANDOFF_MAX_SUMMARY_BYTES, 10 * 1024),
  maxTitleLength: parseEnvInt(process.env.HANDOFF_MAX_TITLE_LENGTH, 200),
  maxKeyLength: parseEnvInt(process.env.HANDOFF_MAX_KEY_LENGTH, 100),
  keyPattern: /^[a-zA-Z0-9_-]+$/,
};

export const connectionConfig: ConnectionConfig = {
  portRange: parsePortRange(process.env.HANDOFF_PORT_RANGE, { start: 1099, end: 1200 }),
  retryCount: parseEnvInt(process.env.HANDOFF_RETRY_COUNT, 30),
  retryIntervalMs: parseEnvInt(process.env.HANDOFF_RETRY_INTERVAL, 10000),
  serverTtlMs: parseEnvInt(process.env.HANDOFF_SERVER_TTL, 24 * 60 * 60 * 1000, 0), // Default: 24 hours, min: 0 (disabled)
  fetchTimeoutMs: parseEnvInt(process.env.HANDOFF_FETCH_TIMEOUT, 30 * 1000), // Default: 30 seconds
};
