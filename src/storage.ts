// =============================================================================
// Dynamic storage provider and re-exports
// =============================================================================

// Re-export all types for backward compatibility
export type {
  Handoff,
  HandoffSummary,
  SaveInput,
  StorageStats,
  MergeInput,
  MergeResult,
  StorageResult,
  Storage,
  StorageMode,
  GetStorageResult,
} from "./types.js";

export { LocalStorage } from "./local-storage.js";
export { RemoteStorage } from "./remote-storage.js";
export type { ReconnectFn } from "./remote-storage.js";

import { type AutoConnectResult, autoConnect } from "./autoconnect.js";
import { LocalStorage } from "./local-storage.js";
import { RemoteStorage } from "./remote-storage.js";
import type { GetStorageResult, StorageMode } from "./types.js";

// =============================================================================
// Module State
// =============================================================================

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

// =============================================================================
// Reconnection
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

// =============================================================================
// Dynamic Storage Provider
// =============================================================================

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
      storage: new RemoteStorage(autoResult.serverUrl, attemptReconnect),
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

/** For testing: reset internal state */
export function resetStorageState(): void {
  localStorageInstance = null;
  previousMode = null;
  previousServerUrl = null;
  cachedAutoConnectResult = null;
  autoConnectInitialized = false;
}
