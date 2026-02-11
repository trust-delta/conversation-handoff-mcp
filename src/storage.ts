import { getAuditLogger } from "./audit.js";
import { type AutoConnectResult, autoConnect, generateKey, generateTitle } from "./autoconnect.js";
import {
  connectionConfig,
  defaultConfig,
  formatBytes,
  sleep,
  splitConversationMessages,
  validateConversation,
  validateHandoff,
  validateKey,
  validateSummary,
  validateTitle,
} from "./validation.js";
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

export interface MergeInput {
  keys: string[];
  new_key?: string;
  new_title?: string;
  new_summary?: string;
  delete_sources: boolean;
  strategy: "chronological" | "sequential";
}

export interface MergeResult {
  message: string;
  merged_key: string;
  source_count: number;
  deleted_sources: boolean;
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
  merge(input: MergeInput): Promise<StorageResult<MergeResult>>;
}

// =============================================================================
// Local Memory Storage
// =============================================================================

/**
 * Local in-memory storage implementation.
 * Data is stored in a Map and persists only for the process lifetime.
 * Supports FIFO auto-deletion when max capacity is reached.
 */
export class LocalStorage implements Storage {
  private handoffs = new Map<string, Handoff>();
  private config: Config;

  /**
   * Create a new LocalStorage instance.
   * @param config - Storage configuration (uses defaults if not provided)
   */
  constructor(config: Config = defaultConfig) {
    this.config = config;
  }

  /**
   * Delete the oldest handoff (FIFO) to make room for new ones.
   * @param protectedKeys - Optional set of keys to exclude from deletion
   */
  private deleteOldestHandoff(protectedKeys?: Set<string>): string | null {
    let oldestKey: string | null = null;
    let oldestDate: Date | null = null;

    for (const [key, handoff] of this.handoffs) {
      if (protectedKeys?.has(key)) continue;
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

  /**
   * Save a handoff to storage.
   * Automatically deletes oldest entry if at capacity (FIFO).
   * @param input - Handoff data to save
   * @returns Result with success message or error
   */
  async save(input: SaveInput): Promise<StorageResult<{ message: string }>> {
    // FIFO: Delete oldest handoff if at capacity (for new keys only)
    const isNewKey = !this.handoffs.has(input.key);
    if (isNewKey && this.handoffs.size >= this.config.maxHandoffs) {
      const deletedKey = this.deleteOldestHandoff();
      if (deletedKey) {
        getAuditLogger().logStorage({
          event: "save",
          key: input.key,
          fifoDeleted: true,
          deletedKey,
          capacityBefore: this.config.maxHandoffs,
          capacityAfter: this.handoffs.size,
          success: true,
        });
      }
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

  /**
   * List all saved handoffs (summaries only, no conversation content).
   * @returns Result with array of handoff summaries
   */
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

  /**
   * Load a specific handoff by key.
   * @param key - Unique identifier of the handoff
   * @param maxMessages - Optional limit on number of messages to return
   * @returns Result with full handoff data or error if not found
   */
  async load(key: string, maxMessages?: number): Promise<StorageResult<Handoff>> {
    const handoff = this.handoffs.get(key);

    if (!handoff) {
      return { success: false, error: `Handoff not found: "${key}"` };
    }

    // Apply message truncation if requested
    if (maxMessages && maxMessages > 0) {
      const messages = splitConversationMessages(handoff.conversation);
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

  /**
   * Clear handoffs from storage.
   * @param key - Optional key to clear specific handoff; if omitted, clears all
   * @returns Result with success message and count of cleared items
   */
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

  /**
   * Get storage statistics including current usage and limits.
   * @returns Result with storage stats
   */
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

  /**
   * Get the internal handoffs Map (for HTTP server use).
   * @returns Map of all handoffs keyed by their key
   */
  getHandoffsMap(): Map<string, Handoff> {
    return this.handoffs;
  }

  /**
   * Get the storage configuration.
   * @returns Current configuration object
   */
  getConfig(): Config {
    return this.config;
  }

  /**
   * Merge multiple handoffs into a single new handoff.
   * Combines conversations, summaries, and metadata from source handoffs.
   * @param input - Merge configuration including source keys and options
   * @returns Result with merge details or error
   */
  async merge(input: MergeInput): Promise<StorageResult<MergeResult>> {
    // 1. Duplicate key check
    const keySet = new Set(input.keys);
    if (keySet.size !== input.keys.length) {
      return { success: false, error: "Duplicate keys found in merge input" };
    }

    // 2. Load all handoffs, error if any not found
    const sources: Handoff[] = [];
    for (const key of input.keys) {
      const handoff = this.handoffs.get(key);
      if (!handoff) {
        return { success: false, error: `Handoff not found: "${key}"` };
      }
      sources.push(handoff);
    }

    // 3. Sort by strategy
    const sorted = [...sources];
    if (input.strategy === "chronological") {
      sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    // sequential: keep array order (no sorting needed)

    // 4. Merge conversations with separator
    const mergedConversation = sorted
      .map((h) => `<!-- Source: ${h.key} -->\n${h.conversation}`)
      .join("\n\n---\n\n");

    // 5. Generate or use provided summary
    let mergedSummary: string;
    if (input.new_summary) {
      mergedSummary = input.new_summary;
    } else {
      const summaryLines = sorted.map((h) => `- [${h.key}] ${h.summary}`);
      mergedSummary = summaryLines.join("\n");
      // Truncate if exceeds limit
      const maxBytes = this.config.maxSummaryBytes;
      if (Buffer.byteLength(mergedSummary, "utf8") > maxBytes) {
        while (Buffer.byteLength(mergedSummary, "utf8") > maxBytes - 3) {
          mergedSummary = mergedSummary.slice(0, -1);
        }
        mergedSummary += "...";
      }
    }

    // 6. Merge from_ai / from_project
    const uniqueAi = [...new Set(sorted.map((h) => h.from_ai))];
    const mergedFromAi = uniqueAi.length === 1 && uniqueAi[0] ? uniqueAi[0] : uniqueAi.join(", ");
    const uniqueProject = [...new Set(sorted.map((h) => h.from_project))];
    const mergedFromProject =
      uniqueProject.length === 1 && uniqueProject[0] !== undefined
        ? uniqueProject[0]
        : uniqueProject.join(", ");

    // 7. Validate merged content
    const convValidation = validateConversation(mergedConversation, this.config);
    if (!convValidation.valid) {
      return { success: false, error: `Merged conversation too large: ${convValidation.error}` };
    }

    const summaryValidation = validateSummary(mergedSummary, this.config);
    if (!summaryValidation.valid) {
      return { success: false, error: `Merged summary too large: ${summaryValidation.error}` };
    }

    // 8. Determine merged key
    const mergedKey = input.new_key || generateKey();

    // Validate key format
    const keyValidation = validateKey(mergedKey, this.config);
    if (!keyValidation.valid) {
      return { success: false, error: keyValidation.error };
    }

    // Check key collision (allow if delete_sources=true and key is a source key)
    if (this.handoffs.has(mergedKey)) {
      const isSourceKey = keySet.has(mergedKey);
      if (!input.delete_sources || !isSourceKey) {
        return { success: false, error: `Key already exists: "${mergedKey}"` };
      }
    }

    // 9. Delete sources if requested (before saving to free capacity)
    if (input.delete_sources) {
      for (const key of input.keys) {
        this.handoffs.delete(key);
      }
    }

    // 10. FIFO capacity check for new key (protect source keys when delete_sources=false)
    const isNewKey = !this.handoffs.has(mergedKey);
    if (isNewKey && this.handoffs.size >= this.config.maxHandoffs) {
      const protectedKeys = input.delete_sources ? new Set<string>() : keySet;
      this.deleteOldestHandoff(protectedKeys);
    }

    // Generate or use provided title
    const mergedTitle = input.new_title || generateTitle(mergedSummary);

    // Validate title
    const titleValidation = validateTitle(mergedTitle, this.config);
    if (!titleValidation.valid) {
      return { success: false, error: titleValidation.error };
    }

    // Save merged handoff
    const mergedHandoff: Handoff = {
      key: mergedKey,
      title: mergedTitle,
      from_ai: mergedFromAi,
      from_project: mergedFromProject,
      created_at: new Date().toISOString(),
      summary: mergedSummary,
      conversation: mergedConversation,
    };

    this.handoffs.set(mergedKey, mergedHandoff);

    getAuditLogger().logStorage({
      event: "merge",
      key: mergedKey,
      dataSize: Buffer.byteLength(mergedConversation, "utf-8"),
      success: true,
    });

    return {
      success: true,
      data: {
        message: `Merged ${input.keys.length} handoffs into "${mergedKey}"`,
        merged_key: mergedKey,
        source_count: input.keys.length,
        deleted_sources: input.delete_sources,
      },
    };
  }
}

// =============================================================================
// Remote HTTP Storage Client
// =============================================================================

/**
 * Attempt to reconnect to a server (discover or start new one).
 * Bypasses the cache for retry purposes.
 * @returns Server URL if reconnection successful, null otherwise
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

/**
 * Remote storage implementation that connects to an HTTP server.
 * Supports automatic reconnection when the server goes down.
 */
export class RemoteStorage implements Storage {
  private serverUrl: string;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts: number;

  /**
   * Create a new RemoteStorage instance.
   * @param serverUrl - HTTP server URL (must use http:// or https://)
   * @throws Error if URL doesn't use http/https protocol
   */
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
   * Attempt to reconnect to a server and update the URL.
   * Applies retry delay between consecutive failed attempts.
   * @returns true if reconnection was successful
   */
  private async tryReconnect(): Promise<boolean> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return false;
    }

    // Apply delay before retry (except for first attempt)
    if (this.reconnectAttempts > 0) {
      await sleep(connectionConfig.retryIntervalMs);
    }

    this.reconnectAttempts++;

    getAuditLogger().logConnection({
      event: "reconnect_attempt",
      retryCount: this.reconnectAttempts,
    });

    const newUrl = await attemptReconnect();
    if (newUrl) {
      this.serverUrl = newUrl.replace(/\/$/, "");
      getAuditLogger().logConnection({
        event: "reconnect_result",
        success: true,
        retryCount: this.reconnectAttempts,
      });
      return true;
    }

    getAuditLogger().logConnection({
      event: "reconnect_result",
      success: false,
      retryCount: this.reconnectAttempts,
    });
    return false;
  }

  /**
   * Send HTTP request to the server with automatic reconnection.
   * @param method - HTTP method (GET, POST, DELETE)
   * @param path - API endpoint path
   * @param body - Optional request body for POST requests
   * @param saveInput - Optional save input for recovery on failure
   * @returns Storage result with data or error
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    saveInput?: SaveInput
  ): Promise<StorageResult<T>> {
    const url = `${this.serverUrl}${path}`;

    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), connectionConfig.fetchTimeoutMs);

    try {
      response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      // Connection failed - attempt reconnect and retry
      const reconnected = await this.tryReconnect();
      if (reconnected) {
        // Retry the request with new server URL (new AbortController will be created)
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
    } finally {
      clearTimeout(timeoutId);
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

  /** @inheritdoc */
  async save(input: SaveInput): Promise<StorageResult<{ message: string }>> {
    return this.request("POST", "/handoff", input, input);
  }

  /** @inheritdoc */
  async list(): Promise<StorageResult<HandoffSummary[]>> {
    return this.request("GET", "/handoff");
  }

  /** @inheritdoc */
  async load(key: string, maxMessages?: number): Promise<StorageResult<Handoff>> {
    const params = maxMessages ? `?max_messages=${maxMessages}` : "";
    return this.request("GET", `/handoff/${encodeURIComponent(key)}${params}`);
  }

  /** @inheritdoc */
  async clear(key?: string): Promise<StorageResult<{ message: string; count?: number }>> {
    if (key) {
      return this.request("DELETE", `/handoff/${encodeURIComponent(key)}`);
    }
    return this.request("DELETE", "/handoff");
  }

  /** @inheritdoc */
  async stats(): Promise<StorageResult<StorageStats>> {
    return this.request("GET", "/stats");
  }

  /** @inheritdoc */
  async merge(input: MergeInput): Promise<StorageResult<MergeResult>> {
    return this.request("POST", "/handoff/merge", input);
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

/**
 * Get or create the singleton LocalStorage instance.
 * Preserves data across mode switches within the same process.
 * @returns LocalStorage singleton instance
 */
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
