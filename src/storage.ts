import { type AutoConnectResult, autoConnect } from "./autoconnect.js";
import { connectionConfig, defaultConfig, formatBytes, validateHandoff } from "./validation.js";
import type { Config } from "./validation.js";

// =============================================================================
// Types
// =============================================================================

export interface Handoff {
  key: string;
  title: string;
  from_ai: string;
  from_project: string;
  created_at: string;
  summary: string;
  conversation: string;
}

export interface HandoffSummary {
  key: string;
  title: string;
  from_ai: string;
  from_project: string;
  created_at: string;
  summary: string;
}

export interface SaveInput {
  key: string;
  title: string;
  summary: string;
  conversation: string;
  from_ai: string;
  from_project: string;
}

export interface StorageStats {
  current: {
    handoffs: number;
    totalBytes: number;
    totalBytesFormatted: string;
  };
  limits: {
    maxHandoffs: number;
    maxConversationBytes: number;
    maxSummaryBytes: number;
    maxTitleLength: number;
    maxKeyLength: number;
  };
  usage: {
    handoffsPercent: number;
  };
}

export interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  /** Suggested action when error occurs */
  suggestion?: string;
  /** Content that failed to save (for manual recovery) */
  pendingContent?: SaveInput;
}

// =============================================================================
// Storage Interface
// =============================================================================

export interface Storage {
  save(input: SaveInput): Promise<StorageResult<{ message: string }>>;
  list(): Promise<StorageResult<HandoffSummary[]>>;
  load(key: string, maxMessages?: number): Promise<StorageResult<Handoff>>;
  clear(key?: string): Promise<StorageResult<{ message: string; count?: number }>>;
  stats(): Promise<StorageResult<StorageStats>>;
}

// =============================================================================
// Local Memory Storage
// =============================================================================

export class LocalStorage implements Storage {
  private handoffs = new Map<string, Handoff>();
  private config: Config;

  constructor(config: Config = defaultConfig) {
    this.config = config;
  }

  /**
   * Delete the oldest handoff (FIFO) to make room for new ones
   */
  private deleteOldestHandoff(): string | null {
    let oldestKey: string | null = null;
    let oldestDate: Date | null = null;

    for (const [key, handoff] of this.handoffs) {
      const createdAt = new Date(handoff.created_at);
      if (oldestDate === null || createdAt < oldestDate) {
        oldestDate = createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.handoffs.delete(oldestKey);
    }

    return oldestKey;
  }

  async save(input: SaveInput): Promise<StorageResult<{ message: string }>> {
    // FIFO: Delete oldest handoff if at capacity (for new keys only)
    const isNewKey = !this.handoffs.has(input.key);
    if (isNewKey && this.handoffs.size >= this.config.maxHandoffs) {
      this.deleteOldestHandoff();
    }

    const validation = validateHandoff(
      input.key,
      input.title,
      input.summary,
      input.conversation,
      this.handoffs.size,
      this.handoffs.has(input.key),
      this.config
    );

    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const handoff: Handoff = {
      key: input.key,
      title: input.title,
      from_ai: input.from_ai,
      from_project: input.from_project,
      created_at: new Date().toISOString(),
      summary: input.summary,
      conversation: input.conversation,
    };

    this.handoffs.set(input.key, handoff);

    return {
      success: true,
      data: { message: `Handoff saved: "${input.title}" (key: ${input.key})` },
    };
  }

  async list(): Promise<StorageResult<HandoffSummary[]>> {
    const summaries: HandoffSummary[] = Array.from(this.handoffs.values()).map((h) => ({
      key: h.key,
      title: h.title,
      from_ai: h.from_ai,
      from_project: h.from_project,
      created_at: h.created_at,
      summary: h.summary,
    }));

    return { success: true, data: summaries };
  }

  async load(key: string, maxMessages?: number): Promise<StorageResult<Handoff>> {
    const handoff = this.handoffs.get(key);

    if (!handoff) {
      return { success: false, error: `Handoff not found: "${key}"` };
    }

    // Apply message truncation if requested
    if (maxMessages && maxMessages > 0) {
      const messages = handoff.conversation.split(/(?=## (?:User|Assistant))/);
      if (messages.length > maxMessages) {
        const truncatedConversation = messages.slice(-maxMessages).join("");
        return {
          success: true,
          data: {
            ...handoff,
            conversation: `[... truncated to last ${maxMessages} messages ...]\n\n${truncatedConversation}`,
          },
        };
      }
    }

    return { success: true, data: handoff };
  }

  async clear(key?: string): Promise<StorageResult<{ message: string; count?: number }>> {
    if (key) {
      if (this.handoffs.has(key)) {
        this.handoffs.delete(key);
        return { success: true, data: { message: `Handoff cleared: "${key}"` } };
      }
      return { success: false, error: `Handoff not found: "${key}"` };
    }

    const count = this.handoffs.size;
    this.handoffs.clear();
    return { success: true, data: { message: "All handoffs cleared", count } };
  }

  async stats(): Promise<StorageResult<StorageStats>> {
    let totalBytes = 0;
    for (const h of this.handoffs.values()) {
      totalBytes += Buffer.byteLength(h.conversation, "utf8");
      totalBytes += Buffer.byteLength(h.summary, "utf8");
      totalBytes += Buffer.byteLength(h.title, "utf8");
      totalBytes += Buffer.byteLength(h.key, "utf8");
    }

    return {
      success: true,
      data: {
        current: {
          handoffs: this.handoffs.size,
          totalBytes,
          totalBytesFormatted: formatBytes(totalBytes),
        },
        limits: {
          maxHandoffs: this.config.maxHandoffs,
          maxConversationBytes: this.config.maxConversationBytes,
          maxSummaryBytes: this.config.maxSummaryBytes,
          maxTitleLength: this.config.maxTitleLength,
          maxKeyLength: this.config.maxKeyLength,
        },
        usage: {
          handoffsPercent: Math.round((this.handoffs.size / this.config.maxHandoffs) * 100),
        },
      },
    };
  }

  // For internal use (HTTP server)
  getHandoffsMap(): Map<string, Handoff> {
    return this.handoffs;
  }

  getConfig(): Config {
    return this.config;
  }
}

// =============================================================================
// Remote HTTP Storage Client
// =============================================================================

/**
 * Attempt to reconnect to a server (discover or start new one)
 * This bypasses the cache for retry purposes
 */
async function attemptReconnect(): Promise<string | null> {
  const result = await autoConnect();
  if (result.serverUrl) {
    // Update the cache for future getStorage() calls
    cachedAutoConnectResult = result;
    return result.serverUrl;
  }
  return null;
}

export class RemoteStorage implements Storage {
  private serverUrl: string;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts: number;

  constructor(serverUrl: string) {
    // Validate URL scheme (only http/https allowed)
    if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
      throw new Error("Server URL must use http:// or https:// protocol");
    }

    // Remove trailing slash if present
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.maxReconnectAttempts = connectionConfig.retryCount;
  }

  /**
   * Attempt to reconnect to a server and update the URL
   * Returns true if reconnection was successful
   */
  private async tryReconnect(): Promise<boolean> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return false;
    }
    this.reconnectAttempts++;

    const newUrl = await attemptReconnect();
    if (newUrl) {
      this.serverUrl = newUrl.replace(/\/$/, "");
      return true;
    }
    return false;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    saveInput?: SaveInput
  ): Promise<StorageResult<T>> {
    const url = `${this.serverUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      // Connection failed - attempt reconnect and retry
      const reconnected = await this.tryReconnect();
      if (reconnected) {
        // Retry the request with new server URL
        return this.request(method, path, body, saveInput);
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      const result: StorageResult<T> = {
        success: false,
        error: `Failed to connect to server: ${message}`,
        suggestion: "Would you like to output the handoff content for manual recovery?",
      };

      // Include pending content for save operations
      if (saveInput) {
        result.pendingContent = saveInput;
      }

      return result;
    }

    // Reset reconnect attempts on successful connection
    this.reconnectAttempts = 0;

    // Parse JSON response safely
    let data: { error?: string } & T;
    try {
      data = await response.json();
    } catch {
      return {
        success: false,
        error: `Invalid response from server: expected JSON (HTTP ${response.status})`,
      };
    }

    if (!response.ok) {
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    return { success: true, data };
  }

  async save(input: SaveInput): Promise<StorageResult<{ message: string }>> {
    return this.request("POST", "/handoff", input, input);
  }

  async list(): Promise<StorageResult<HandoffSummary[]>> {
    return this.request("GET", "/handoff");
  }

  async load(key: string, maxMessages?: number): Promise<StorageResult<Handoff>> {
    const params = maxMessages ? `?max_messages=${maxMessages}` : "";
    return this.request("GET", `/handoff/${encodeURIComponent(key)}${params}`);
  }

  async clear(key?: string): Promise<StorageResult<{ message: string; count?: number }>> {
    if (key) {
      return this.request("DELETE", `/handoff/${encodeURIComponent(key)}`);
    }
    return this.request("DELETE", "/handoff");
  }

  async stats(): Promise<StorageResult<StorageStats>> {
    return this.request("GET", "/stats");
  }
}

// =============================================================================
// Dynamic Storage Provider
// =============================================================================

export type StorageMode = "shared" | "standalone" | "standalone-explicit";

export interface GetStorageResult {
  storage: Storage;
  mode: StorageMode;
  serverUrl?: string;
  autoStarted?: boolean;
}

// Singleton local storage instance (preserves data across mode switches)
let localStorageInstance: LocalStorage | null = null;

function getLocalStorage(): LocalStorage {
  if (!localStorageInstance) {
    localStorageInstance = new LocalStorage();
  }
  return localStorageInstance;
}

// Track previous mode for logging deduplication
let previousMode: StorageMode | null = null;
let previousServerUrl: string | null = null;

// Cached auto-connect result (avoid repeated server startup attempts)
let cachedAutoConnectResult: AutoConnectResult | null = null;
let autoConnectInitialized = false;

/**
 * Get storage dynamically based on server availability.
 * In v0.4.0+, server auto-start is the default behavior.
 * Called on each request to enable dynamic mode switching.
 */
export async function getStorage(): Promise<GetStorageResult> {
  const serverEnv = process.env.HANDOFF_SERVER;

  // Explicit standalone mode (no warning, no health check, no auto-start)
  if (serverEnv === "none") {
    const mode: StorageMode = "standalone-explicit";
    if (previousMode !== mode) {
      previousMode = mode;
      previousServerUrl = null;
    }
    return {
      storage: getLocalStorage(),
      mode,
    };
  }

  // If explicit server URL is provided, use it directly
  if (serverEnv && serverEnv !== "none") {
    return {
      storage: new RemoteStorage(serverEnv),
      mode: "shared",
      serverUrl: serverEnv,
    };
  }

  // Auto-connect: discover or start server (only once per process)
  if (!autoConnectInitialized) {
    cachedAutoConnectResult = await autoConnect();
    autoConnectInitialized = true;
  }

  const autoResult = cachedAutoConnectResult;

  if (autoResult?.serverUrl) {
    const mode: StorageMode = "shared";
    if (previousMode !== mode || previousServerUrl !== autoResult.serverUrl) {
      previousMode = mode;
      previousServerUrl = autoResult.serverUrl;
    }
    return {
      storage: new RemoteStorage(autoResult.serverUrl),
      mode,
      serverUrl: autoResult.serverUrl,
      autoStarted: autoResult.autoStarted,
    };
  }

  // Fallback to standalone (silently, no warnings in v0.4.0+)
  const mode: StorageMode = "standalone";
  if (previousMode !== mode) {
    previousMode = mode;
    previousServerUrl = null;
  }

  return {
    storage: getLocalStorage(),
    mode,
  };
}

/**
 * Force retry auto-connect (useful after connection failures)
 */
export async function retryAutoConnect(): Promise<GetStorageResult> {
  cachedAutoConnectResult = null;
  autoConnectInitialized = false;
  return getStorage();
}

// For testing: reset internal state
export function resetStorageState(): void {
  localStorageInstance = null;
  previousMode = null;
  previousServerUrl = null;
  cachedAutoConnectResult = null;
  autoConnectInitialized = false;
}
