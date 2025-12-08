import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type PortRange, connectionConfig } from "./validation.js";

// =============================================================================
// Types
// =============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Port Scanning
// =============================================================================

/** Timeout for health check requests in milliseconds */
const HEALTH_CHECK_TIMEOUT_MS = 300;

/**
 * Check if a handoff server is running on the specified port.
 * @param port - Port number to check
 * @returns true if a handoff server is responding on the port
 */
async function checkPort(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/`, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    if (response.ok) {
      const data = (await response.json()) as { name?: string };
      return data.name === "conversation-handoff-server";
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Scan ports in parallel to find a running handoff server.
 * @param portRange - Port range to scan (start and end inclusive)
 * @returns Port number if a server is found, null otherwise
 */
export async function scanForServer(portRange: PortRange): Promise<number | null> {
  const ports = [];
  for (let p = portRange.start; p <= portRange.end; p++) {
    ports.push(p);
  }

  const results = await Promise.all(
    ports.map(async (port) => {
      const isRunning = await checkPort(port);
      return isRunning ? port : null;
    })
  );

  for (const port of results) {
    if (port !== null) {
      return port;
    }
  }
  return null;
}

/**
 * Find an available (unused) port in the given range.
 * @param portRange - Port range to search (start and end inclusive)
 * @returns First available port number, or null if all ports are in use
 */
export async function findAvailablePort(portRange: PortRange): Promise<number | null> {
  for (let port = portRange.start; port <= portRange.end; port++) {
    const isInUse = await isPortInUse(port);
    if (!isInUse) {
      return port;
    }
  }
  return null;
}

/**
 * Check if a port is currently in use.
 * @param port - Port number to check
 * @returns true if the port is in use, false if available
 */
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close();
      resolve(false);
    });
    server.listen(port, "127.0.0.1");
  });
}

// =============================================================================
// Server Auto-Start
// =============================================================================

/**
 * Start the handoff server as a detached background process.
 * The process will continue running even after the parent exits.
 * @param port - Port number for the server to listen on
 */
export function startServerBackground(port: number): void {
  const indexPath = join(__dirname, "index.js");

  const child = spawn("node", [indexPath, "--serve", "--port", String(port)], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
}

/**
 * Wait for a server to become available on the specified port.
 * Polls the port repeatedly until the server responds or max attempts reached.
 * @param port - Port number to wait for
 * @param maxAttempts - Maximum number of polling attempts (default: 20)
 * @param intervalMs - Interval between polling attempts in ms (default: 100)
 * @returns true if server became available, false if timed out
 */
export async function waitForServer(
  port: number,
  maxAttempts = 20,
  intervalMs = 100
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const isRunning = await checkPort(port);
    if (isRunning) {
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
}

// =============================================================================
// Auto-Connect Logic
// =============================================================================

export interface AutoConnectResult {
  serverUrl: string | null;
  mode: "shared" | "standalone";
  autoStarted: boolean;
}

/**
 * Automatically discover an existing server or start a new one.
 * This is the main entry point for auto-connect functionality.
 *
 * Process:
 * 1. Scan port range for existing server
 * 2. If not found, find available port and start new server
 * 3. Return server URL or fall back to standalone mode
 *
 * @returns AutoConnectResult with serverUrl, mode, and autoStarted flag
 */
export async function autoConnect(): Promise<AutoConnectResult> {
  const { portRange } = connectionConfig;

  // 1. Scan for existing server in port range (parallel scan, no cache)
  const existingPort = await scanForServer(portRange);
  if (existingPort !== null) {
    return {
      serverUrl: `http://localhost:${existingPort}`,
      mode: "shared",
      autoStarted: false,
    };
  }

  // 2. Find available port and start server
  const availablePort = await findAvailablePort(portRange);
  if (availablePort === null) {
    // No available port, fallback to standalone
    return {
      serverUrl: null,
      mode: "standalone",
      autoStarted: false,
    };
  }

  // 3. Start server in background
  startServerBackground(availablePort);

  // 4. Wait for server to be ready
  const serverReady = await waitForServer(availablePort);
  if (serverReady) {
    return {
      serverUrl: `http://localhost:${availablePort}`,
      mode: "shared",
      autoStarted: true,
    };
  }

  // Server failed to start, fallback to standalone
  return {
    serverUrl: null,
    mode: "standalone",
    autoStarted: false,
  };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Sleep for specified milliseconds.
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique handoff key with timestamp and random suffix.
 * Format: handoff-YYYYMMDDHHMMSS-random6chars
 * @returns Unique key string
 */
export function generateKey(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHMMSS
  const random = Math.random().toString(36).slice(2, 8);
  return `handoff-${timestamp}-${random}`;
}

/**
 * Generate a title from the summary text.
 * Truncates to 50 characters with ellipsis if needed.
 * @param summary - Summary text to generate title from
 * @returns Title string (max 50 chars)
 */
export function generateTitle(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length <= 50) {
    return trimmed;
  }
  return `${trimmed.slice(0, 47)}...`;
}
