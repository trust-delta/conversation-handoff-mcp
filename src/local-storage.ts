// =============================================================================
// Local in-memory storage implementation
// =============================================================================

import { getAuditLogger } from "./audit.js";
import { generateKey, generateTitle } from "./autoconnect.js";
import type { Config } from "./config.js";
import { defaultConfig } from "./config.js";
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
import {
  formatBytes,
  splitConversationMessages,
  validateConversation,
  validateHandoff,
  validateKey,
  validateSummary,
  validateTitle,
} from "./validation.js";

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
      metadata: validation.inputSizes ? { inputSizes: validation.inputSizes } : undefined,
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
