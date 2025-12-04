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
    // Remove trailing slash if present
    this.serverUrl = serverUrl.replace(/\/$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<StorageResult<T>> {
    const url = `${this.serverUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || `HTTP ${response.status}` };
      }

      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: `Failed to connect to server: ${message}` };
    }
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
// Factory
// =============================================================================

export function createStorage(): Storage {
  const serverUrl = process.env.HANDOFF_SERVER;

  if (serverUrl) {
    console.error(`Connecting to remote handoff server: ${serverUrl}`);
    return new RemoteStorage(serverUrl);
  }

  console.error("Using local in-memory storage");
  return new LocalStorage();
}
