import { defaultConfig, formatBytes, validateHandoff } from "./validation.js";
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

  async save(input: SaveInput): Promise<StorageResult<{ message: string }>> {
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

export class RemoteStorage implements Storage {
  private serverUrl: string;

  constructor(serverUrl: string) {
    // Validate URL scheme (only http/https allowed)
    if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
      throw new Error("Server URL must use http:// or https:// protocol");
    }

    // Remove trailing slash if present
    this.serverUrl = serverUrl.replace(/\/$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
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
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: `Failed to connect to server: ${message}` };
    }

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
    return this.request("POST", "/handoff", input);
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
// Health Check
// =============================================================================

const DEFAULT_SERVER = "http://localhost:1099";
const HEALTH_CHECK_TIMEOUT_MS = 500; // Short timeout for per-request checks

async function checkServerHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/`, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
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
}

// Singleton local storage instance (preserves data across mode switches)
let localStorageInstance: LocalStorage | null = null;

function getLocalStorage(): LocalStorage {
  if (!localStorageInstance) {
    localStorageInstance = new LocalStorage();
  }
  return localStorageInstance;
}

// Track previous mode for warning deduplication
let previousMode: StorageMode | null = null;
let previousServerUrl: string | null = null;

/**
 * Get storage dynamically based on server availability.
 * Called on each request to enable dynamic mode switching.
 */
export async function getStorage(): Promise<GetStorageResult> {
  const serverEnv = process.env.HANDOFF_SERVER;

  // Explicit standalone mode (no warning, no health check)
  if (serverEnv === "none") {
    const mode: StorageMode = "standalone-explicit";
    if (previousMode !== mode) {
      console.error("[conversation-handoff] Standalone mode (explicit)");
      previousMode = mode;
      previousServerUrl = null;
    }
    return {
      storage: getLocalStorage(),
      mode,
    };
  }

  // Determine target server URL
  const targetUrl = serverEnv || DEFAULT_SERVER;

  // Check server availability
  const isAvailable = await checkServerHealth(targetUrl);

  if (isAvailable) {
    const mode: StorageMode = "shared";
    // Log only on mode change or server URL change
    if (previousMode !== mode || previousServerUrl !== targetUrl) {
      console.error(`[conversation-handoff] Shared mode: ${targetUrl}`);
      previousMode = mode;
      previousServerUrl = targetUrl;
    }
    return {
      storage: new RemoteStorage(targetUrl),
      mode,
      serverUrl: targetUrl,
    };
  }

  // Fallback to standalone with warning (only on mode change)
  const mode: StorageMode = "standalone";
  if (previousMode !== mode || previousServerUrl !== targetUrl) {
    const isDefault = !serverEnv;
    if (isDefault) {
      console.warn(
        `[conversation-handoff] Shared server (${targetUrl}) not available. Running in standalone mode.`
      );
      console.warn(
        "[conversation-handoff] To share handoffs, start a server: npx conversation-handoff-mcp --serve"
      );
    } else {
      console.warn(
        `[conversation-handoff] Cannot connect to server (${targetUrl}). Falling back to standalone mode.`
      );
    }
    previousMode = mode;
    previousServerUrl = targetUrl;
  }

  return {
    storage: getLocalStorage(),
    mode,
  };
}

// For testing: reset internal state
export function resetStorageState(): void {
  localStorageInstance = null;
  previousMode = null;
  previousServerUrl = null;
}
