// =============================================================================
// Remote HTTP storage client implementation
// =============================================================================

import { getAuditLogger } from "./audit.js";
import { connectionConfig } from "./config.js";
import type {
  Handoff,
  HandoffSummary,
  MergeInput,
  MergeResult,
  SaveInput,
  Storage,
  StorageResult,
  StorageStats,
} from "./types.js";
import { sleep } from "./validation.js";

/** Function type for reconnecting to a server */
export type ReconnectFn = () => Promise<string | null>;

/**
 * Remote storage implementation that connects to an HTTP server.
 * Supports automatic reconnection when the server goes down.
 */
export class RemoteStorage implements Storage {
  private serverUrl: string;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectFn?: ReconnectFn;

  /**
   * Create a new RemoteStorage instance.
   * @param serverUrl - HTTP server URL (must use http:// or https://)
   * @param reconnectFn - Optional function to attempt server reconnection
   * @throws Error if URL doesn't use http/https protocol
   */
  constructor(serverUrl: string, reconnectFn?: ReconnectFn) {
    // Validate URL scheme (only http/https allowed)
    if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
      throw new Error("Server URL must use http:// or https:// protocol");
    }

    // Remove trailing slash if present
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.maxReconnectAttempts = connectionConfig.retryCount;
    this.reconnectFn = reconnectFn;
  }

  /**
   * Attempt to reconnect to a server and update the URL.
   * Applies retry delay between consecutive failed attempts.
   * @returns true if reconnection was successful
   */
  private async tryReconnect(): Promise<boolean> {
    if (!this.reconnectFn) return false;
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

    const newUrl = await this.reconnectFn();
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

      // Categorize error for better diagnostics
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      const message = error instanceof Error ? error.message : "Unknown error";
      const errorDetail = isTimeout
        ? `Request timed out after ${connectionConfig.fetchTimeoutMs}ms (${method} ${path})`
        : `Network error: ${message} (${method} ${path})`;

      const result: StorageResult<T> = {
        success: false,
        error: `Failed to connect to server: ${errorDetail}`,
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
      const statusText = response.status >= 500 ? "Server error" : "Request error";
      return {
        success: false,
        error: data.error || `${statusText}: HTTP ${response.status} (${method} ${path})`,
      };
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
