import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

// =============================================================================
// Types
// =============================================================================

export type AuditCategory =
  | "lifecycle"
  | "tool"
  | "storage"
  | "connection"
  | "http"
  | "validation"
  | "performance";

/** Base fields present on every audit entry */
interface AuditEntryBase {
  timestamp: string;
  category: AuditCategory;
  sessionId: string;
}

/** Fields auto-populated by AuditLogger (callers don't need to provide these) */
type AutoPopulatedFields = "timestamp" | "sessionId" | "category";

/** lifecycle: startup / shutdown */
export interface LifecycleEntry extends AuditEntryBase {
  category: "lifecycle";
  event: "startup" | "shutdown";
  mode?: string;
  version?: string;
  port?: number;
  config?: Record<string, unknown>;
  uptimeSeconds?: number;
}

/** tool: tool_call */
export interface ToolEntry extends AuditEntryBase {
  category: "tool";
  event: "tool_call";
  toolName: string;
  durationMs: number;
  success: boolean;
  error?: string;
  inputSizes?: {
    conversationBytes?: number;
    summaryBytes?: number;
  };
}

/** storage: save/load/list/clear/merge/stats */
export interface StorageEntry extends AuditEntryBase {
  category: "storage";
  event: "save" | "load" | "list" | "clear" | "merge" | "stats";
  key?: string;
  dataSize?: number;
  fifoDeleted?: boolean;
  deletedKey?: string;
  capacityBefore?: number;
  capacityAfter?: number;
  success: boolean;
  error?: string;
}

/** connection: scan/server lifecycle/reconnect */
export interface ConnectionEntry extends AuditEntryBase {
  category: "connection";
  event:
    | "scan_start"
    | "scan_result"
    | "server_spawn"
    | "server_ready"
    | "reconnect_attempt"
    | "reconnect_result";
  portCount?: number;
  durationMs?: number;
  port?: number;
  success?: boolean;
  retryCount?: number;
}

/** http: request */
export interface HttpEntry extends AuditEntryBase {
  category: "http";
  event: "request";
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  requestSize?: number;
  responseSize?: number;
}

/** validation: validation_failure / truncation */
export interface ValidationEntry extends AuditEntryBase {
  category: "validation";
  event: "validation_failure" | "truncation";
  field: string;
  limit?: number;
  actual?: number;
  error?: string;
}

/** performance: snapshot */
export interface PerformanceEntry extends AuditEntryBase {
  category: "performance";
  event: "snapshot";
  memoryUsageMB: number;
  activeHandoffs: number;
  uptimeSeconds: number;
}

export type AuditEntry =
  | LifecycleEntry
  | ToolEntry
  | StorageEntry
  | ConnectionEntry
  | HttpEntry
  | ValidationEntry
  | PerformanceEntry;

// =============================================================================
// Configuration
// =============================================================================

/** Default audit log output directory */
const DEFAULT_AUDIT_DIR = "/tmp/conversation-handoff-mcp";

/** Maximum single file size in bytes before rotation (10MB) */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum number of rotated files to keep */
const MAX_ROTATED_FILES = 5;

/** Performance snapshot interval in milliseconds (60s) */
const PERFORMANCE_SNAPSHOT_INTERVAL_MS = 60 * 1000;

// =============================================================================
// Timer Helper
// =============================================================================

export interface AuditTimer {
  /** Returns elapsed time in milliseconds since timer creation */
  elapsed: () => number;
}

/** No-op timer returned when audit is disabled */
const NOOP_TIMER: AuditTimer = { elapsed: () => 0 };

// =============================================================================
// Write Queue (async, non-blocking)
// =============================================================================

/**
 * Asynchronous write queue that buffers log entries and writes them
 * in order without blocking the caller.
 */
class WriteQueue {
  private queue: string[] = [];
  private flushing = false;
  private filePath: string;

  /**
   * @param filePath - Path to the JSONL log file
   */
  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Enqueue a line to be written. Triggers an async flush if not already running.
   * @param line - JSONL line to append
   */
  enqueue(line: string): void {
    this.queue.push(line);
    if (!this.flushing) {
      void this.flush();
    }
  }

  /**
   * Flush all queued lines to the file.
   * Processes the queue in batches to minimize I/O calls.
   */
  private async flush(): Promise<void> {
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.queue.length);
        const data = batch.join("");
        await appendFile(this.filePath, data, "utf-8");
      }
    } catch (error) {
      // Audit logging should never crash the main process
      console.error("[audit] Write error:", error);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Wait until all pending writes are flushed.
   */
  async drain(): Promise<void> {
    // If there are items in queue, flush them
    if (this.queue.length > 0 && !this.flushing) {
      await this.flush();
    }
    // Wait for any ongoing flush to complete
    while (this.flushing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * Get current file path.
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Update the file path (used after rotation).
   * @param newPath - New file path
   */
  setFilePath(newPath: string): void {
    this.filePath = newPath;
  }
}

// =============================================================================
// AuditLogger
// =============================================================================

/**
 * Structured audit logger for the MCP server.
 * Writes JSONL entries to files under the audit directory.
 * When disabled, all methods are no-ops with near-zero overhead.
 */
export class AuditLogger {
  private enabled: boolean;
  private sessionId: string;
  private auditDir: string;
  private writeQueue: WriteQueue | null = null;
  private perfInterval: ReturnType<typeof setInterval> | null = null;
  private startTime: number = Date.now();
  private activeHandoffsGetter: (() => number) | null = null;
  private currentFileSize = 0;
  private rotating = false;

  /**
   * @param enabled - Whether audit logging is active
   * @param auditDir - Directory path for log files
   */
  constructor(enabled: boolean, auditDir: string = DEFAULT_AUDIT_DIR) {
    this.enabled = enabled;
    this.sessionId = randomUUID().replace(/-/g, "").slice(0, 8);
    this.auditDir = auditDir;
  }

  /**
   * Initialize the logger: create directory, open log file,
   * and start the performance snapshot timer.
   * Must be called before logging any entries.
   */
  async init(): Promise<void> {
    if (!this.enabled) return;

    await mkdir(this.auditDir, { recursive: true });

    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHMMSS
    const filename = `audit-${ts}-${this.sessionId}.jsonl`;
    const filePath = join(this.auditDir, filename);

    // Create the file to ensure it exists
    await writeFile(filePath, "", "utf-8");

    this.writeQueue = new WriteQueue(filePath);
    this.currentFileSize = 0;

    // Start periodic performance snapshots
    this.startPerformanceSnapshots();
  }

  /**
   * Check if audit logging is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the current session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the current log file path.
   */
  getFilePath(): string | null {
    return this.writeQueue?.getFilePath() ?? null;
  }

  /**
   * Register a function to get the current number of active handoffs.
   * Used by performance snapshots.
   * @param getter - Function returning the current active handoff count
   */
  setActiveHandoffsGetter(getter: () => number): void {
    this.activeHandoffsGetter = getter;
  }

  // ---------------------------------------------------------------------------
  // Timer
  // ---------------------------------------------------------------------------

  /**
   * Create a timer for measuring operation duration.
   * Returns a no-op timer when audit is disabled.
   * @returns AuditTimer with elapsed() method
   */
  startTimer(): AuditTimer {
    if (!this.enabled) return NOOP_TIMER;
    const start = performance.now();
    return {
      elapsed: () => Math.round(performance.now() - start),
    };
  }

  // ---------------------------------------------------------------------------
  // Category-specific log methods
  // ---------------------------------------------------------------------------

  /**
   * Log a lifecycle event (startup/shutdown).
   * @param data - Lifecycle-specific fields (excluding base fields)
   */
  logLifecycle(data: Omit<LifecycleEntry, AutoPopulatedFields>): void {
    this.log({ category: "lifecycle", ...data });
  }

  /**
   * Log a tool call event.
   * @param data - Tool-specific fields (excluding base fields)
   */
  logTool(data: Omit<ToolEntry, AutoPopulatedFields>): void {
    this.log({ category: "tool", ...data });
  }

  /**
   * Log a storage event.
   * @param data - Storage-specific fields (excluding base fields)
   */
  logStorage(data: Omit<StorageEntry, AutoPopulatedFields>): void {
    this.log({ category: "storage", ...data });
  }

  /**
   * Log a connection event.
   * @param data - Connection-specific fields (excluding base fields)
   */
  logConnection(data: Omit<ConnectionEntry, AutoPopulatedFields>): void {
    this.log({ category: "connection", ...data });
  }

  /**
   * Log an HTTP request event.
   * @param data - HTTP-specific fields (excluding base fields)
   */
  logHttp(data: Omit<HttpEntry, AutoPopulatedFields>): void {
    this.log({ category: "http", ...data });
  }

  /**
   * Log a validation event.
   * @param data - Validation-specific fields (excluding base fields)
   */
  logValidation(data: Omit<ValidationEntry, AutoPopulatedFields>): void {
    this.log({ category: "validation", ...data });
  }

  /**
   * Log a performance snapshot.
   * @param data - Performance-specific fields (excluding base fields)
   */
  logPerformance(data: Omit<PerformanceEntry, AutoPopulatedFields>): void {
    this.log({ category: "performance", ...data });
  }

  // ---------------------------------------------------------------------------
  // Core logging
  // ---------------------------------------------------------------------------

  /**
   * Write a log entry as a JSONL line.
   * Handles file rotation when size limit is exceeded.
   * @param data - Partial audit entry (base fields are added automatically)
   */
  private log(data: Omit<AuditEntry, "timestamp" | "sessionId">): void {
    if (!this.enabled || !this.writeQueue) return;

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      ...data,
    } as AuditEntry;

    const line = `${JSON.stringify(entry)}\n`;
    this.currentFileSize += Buffer.byteLength(line, "utf-8");
    this.writeQueue.enqueue(line);

    // Check if rotation is needed (async, non-blocking)
    if (this.currentFileSize >= MAX_FILE_SIZE_BYTES) {
      void this.rotate();
    }
  }

  // ---------------------------------------------------------------------------
  // File Rotation
  // ---------------------------------------------------------------------------

  /**
   * Rotate the current log file.
   * Renames the current file with a .1 suffix (shifting existing rotated files),
   * and opens a new empty file.
   */
  private async rotate(): Promise<void> {
    if (!this.writeQueue || this.rotating) return;
    this.rotating = true;

    const currentPath = this.writeQueue.getFilePath();

    try {
      // Wait for pending writes to complete
      await this.writeQueue.drain();

      // Shift existing rotated files (.4 -> .5, .3 -> .4, etc.)
      for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
        const from = `${currentPath}.${i}`;
        const to = `${currentPath}.${i + 1}`;
        try {
          await rename(from, to);
        } catch {
          // File doesn't exist, skip
        }
      }

      // Delete oldest if exceeds max
      try {
        await unlink(`${currentPath}.${MAX_ROTATED_FILES + 1}`);
      } catch {
        // File doesn't exist, skip
      }

      // Rename current to .1
      await rename(currentPath, `${currentPath}.1`);

      // Create new empty file
      await writeFile(currentPath, "", "utf-8");
      this.currentFileSize = 0;
    } catch (error) {
      console.error("[audit] Rotation error:", error);
    } finally {
      this.rotating = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Performance Snapshots
  // ---------------------------------------------------------------------------

  /**
   * Start periodic performance snapshots.
   * Uses .unref() so the timer doesn't keep the process alive.
   */
  private startPerformanceSnapshots(): void {
    this.perfInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const memoryUsageMB = Math.round((memUsage.heapUsed / 1024 / 1024) * 10) / 10;
      const activeHandoffs = this.activeHandoffsGetter?.() ?? 0;
      const uptimeSeconds = Math.round((Date.now() - this.startTime) / 1000);

      this.logPerformance({
        event: "snapshot",
        memoryUsageMB,
        activeHandoffs,
        uptimeSeconds,
      });
    }, PERFORMANCE_SNAPSHOT_INTERVAL_MS);

    // Don't keep process alive just for snapshots
    this.perfInterval.unref();
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  /**
   * Gracefully shut down the audit logger.
   * Stops the performance snapshot timer and flushes remaining writes.
   */
  async shutdown(): Promise<void> {
    if (!this.enabled) return;

    // Stop performance snapshots
    if (this.perfInterval) {
      clearInterval(this.perfInterval);
      this.perfInterval = null;
    }

    // Flush remaining writes
    if (this.writeQueue) {
      await this.writeQueue.drain();
    }
  }

  // ---------------------------------------------------------------------------
  // File list (for testing/debugging)
  // ---------------------------------------------------------------------------

  /**
   * List all audit log files in the audit directory.
   * @returns Array of file names sorted by modification time (newest first)
   */
  async listFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.auditDir);
      const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl") || f.includes(".jsonl."));

      // Sort by modification time (newest first)
      const withStats = await Promise.all(
        jsonlFiles.map(async (name) => {
          const fileStat = await stat(join(this.auditDir, name));
          return { name, mtime: fileStat.mtimeMs };
        })
      );
      withStats.sort((a, b) => b.mtime - a.mtime);

      return withStats.map((f) => f.name);
    } catch {
      return [];
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

/** Global audit logger singleton */
let _logger: AuditLogger | null = null;

/**
 * Initialize the global audit logger.
 * Should be called once at startup.
 * @param enabled - Whether to enable audit logging (from --audit flag or HANDOFF_AUDIT env)
 * @param auditDir - Optional custom directory (default: /tmp/conversation-handoff-mcp)
 * @returns The initialized AuditLogger instance
 */
export async function initAudit(enabled: boolean, auditDir?: string): Promise<AuditLogger> {
  _logger = new AuditLogger(enabled, auditDir);
  await _logger.init();
  return _logger;
}

/**
 * Get the global audit logger instance.
 * Returns a disabled no-op logger if not yet initialized.
 */
export function getAuditLogger(): AuditLogger {
  if (!_logger) {
    // Return a disabled instance as fallback
    _logger = new AuditLogger(false);
  }
  return _logger;
}

/**
 * Reset the global audit logger (for testing).
 */
export function resetAudit(): void {
  _logger = null;
}
