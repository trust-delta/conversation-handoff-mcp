// =============================================================================
// Local in-memory storage implementation
// =============================================================================

import { getAuditLogger } from "./audit.js";
import { generateKey, generateTitle } from "./autoconnect.js";
import type { Config } from "./config.js";
import { defaultConfig } from "./config.js";
import type {
  Comment,
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
  validateNextAction,
  validateStatus,
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
  private comments = new Map<string, Comment[]>();
  private commentCounter = 0;
  private config: Config;
  /** Cached total byte size of all handoffs (updated incrementally) */
  private cachedTotalBytes = 0;
  /** Per-handoff byte size cache to avoid redundant Buffer.byteLength calls */
  private byteSizeCache = new WeakMap<Handoff, number>();

  /**
   * Create a new LocalStorage instance.
   * @param config - Storage configuration (uses defaults if not provided)
   */
  constructor(config: Config = defaultConfig) {
    this.config = config;
  }

  /** Calculate the total byte size of a handoff entry (cached via WeakMap) */
  private handoffBytes(h: Handoff): number {
    const cached = this.byteSizeCache.get(h);
    if (cached !== undefined) return cached;

    const size =
      Buffer.byteLength(h.conversation, "utf8") +
      Buffer.byteLength(h.summary, "utf8") +
      Buffer.byteLength(h.title, "utf8") +
      Buffer.byteLength(h.key, "utf8");
    this.byteSizeCache.set(h, size);
    return size;
  }

  /**
   * Delete the oldest handoff (FIFO) to make room for new ones.
   * @param protectedKeys - Optional set of keys to exclude from deletion
   */
  private deleteOldestHandoff(protectedKeys?: Set<string>): string | null {
    let oldestKey: string | null = null;
    let oldestTimestamp: string | null = null;

    for (const [key, handoff] of this.handoffs) {
      if (protectedKeys?.has(key)) continue;
      // ISO 8601 strings are lexicographically comparable (no Date parsing needed)
      if (oldestTimestamp === null || handoff.created_at < oldestTimestamp) {
        oldestTimestamp = handoff.created_at;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const deleted = this.handoffs.get(oldestKey);
      if (deleted) this.cachedTotalBytes -= this.handoffBytes(deleted);
      this.handoffs.delete(oldestKey);
      this.comments.delete(oldestKey);
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

    // Validate optional metadata fields
    if (input.status !== undefined) {
      const statusResult = validateStatus(input.status);
      if (!statusResult.valid) {
        return { success: false, error: statusResult.error };
      }
    }
    if (input.next_action !== undefined) {
      const nextActionResult = validateNextAction(input.next_action, this.config);
      if (!nextActionResult.valid) {
        return { success: false, error: nextActionResult.error };
      }
    }

    // Subtract old bytes and clear comments if overwriting existing key
    const existing = this.handoffs.get(input.key);
    if (existing) {
      this.cachedTotalBytes -= this.handoffBytes(existing);
      this.comments.delete(input.key);
    }

    // Auto-calculate metadata fields
    const messageCount =
      input.message_count ?? splitConversationMessages(input.conversation).length;
    const conversationBytes =
      input.conversation_bytes ??
      validation.inputSizes?.conversationBytes ??
      Buffer.byteLength(input.conversation, "utf8");
    const status = input.status ?? "active";

    const handoff: Handoff = {
      key: input.key,
      title: input.title,
      from_ai: input.from_ai,
      from_project: input.from_project,
      created_at: new Date().toISOString(),
      summary: input.summary,
      conversation: input.conversation,
      message_count: messageCount,
      conversation_bytes: conversationBytes,
      status,
      ...(input.next_action !== undefined ? { next_action: input.next_action } : {}),
    };

    this.handoffs.set(input.key, handoff);

    // Pre-populate byte size cache from validation inputSizes to avoid redundant calculation
    if (
      validation.inputSizes?.conversationBytes != null &&
      validation.inputSizes?.summaryBytes != null
    ) {
      const size =
        validation.inputSizes.conversationBytes +
        validation.inputSizes.summaryBytes +
        Buffer.byteLength(handoff.title, "utf8") +
        Buffer.byteLength(handoff.key, "utf8");
      this.byteSizeCache.set(handoff, size);
    }

    this.cachedTotalBytes += this.handoffBytes(handoff);

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
      comment_count: this.comments.get(h.key)?.length ?? 0,
      message_count: h.message_count,
      conversation_bytes: h.conversation_bytes,
      status: h.status,
      ...(h.next_action !== undefined ? { next_action: h.next_action } : {}),
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

    const comments = this.comments.get(key) ?? [];

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
            comments,
          },
        };
      }
    }

    return { success: true, data: { ...handoff, comments } };
  }

  /**
   * Clear handoffs from storage.
   * @param key - Optional key to clear specific handoff; if omitted, clears all
   * @returns Result with success message and count of cleared items
   */
  async clear(key?: string): Promise<StorageResult<{ message: string; count?: number }>> {
    if (key) {
      const existing = this.handoffs.get(key);
      if (existing) {
        this.cachedTotalBytes -= this.handoffBytes(existing);
        this.handoffs.delete(key);
        this.comments.delete(key);
        return { success: true, data: { message: `Handoff cleared: "${key}"` } };
      }
      return { success: false, error: `Handoff not found: "${key}"` };
    }

    const count = this.handoffs.size;
    this.handoffs.clear();
    this.comments.clear();
    this.cachedTotalBytes = 0;
    return { success: true, data: { message: "All handoffs cleared", count } };
  }

  /**
   * Get storage statistics including current usage and limits.
   * @returns Result with storage stats
   */
  async stats(): Promise<StorageResult<StorageStats>> {
    let totalComments = 0;
    for (const comments of this.comments.values()) {
      totalComments += comments.length;
    }

    return {
      success: true,
      data: {
        current: {
          handoffs: this.handoffs.size,
          totalComments,
          totalBytes: this.cachedTotalBytes,
          totalBytesFormatted: formatBytes(this.cachedTotalBytes),
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
      // ISO 8601 strings are lexicographically comparable (no Date parsing needed)
      sorted.sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
      );
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
      // Truncate if exceeds limit (estimate target length to avoid O(n²) loop)
      const maxBytes = this.config.maxSummaryBytes;
      const currentBytes = Buffer.byteLength(mergedSummary, "utf8");
      if (currentBytes > maxBytes) {
        const ratio = (maxBytes - 3) / currentBytes;
        let targetLen = Math.floor(mergedSummary.length * ratio);
        mergedSummary = mergedSummary.slice(0, targetLen);
        // Fine-tune: trim at most a few chars for multi-byte boundary
        while (Buffer.byteLength(mergedSummary, "utf8") > maxBytes - 3) {
          targetLen--;
          mergedSummary = mergedSummary.slice(0, targetLen);
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

    // 9. Collect comments from source handoffs before deletion
    const mergedComments: Comment[] = [];
    for (const h of sorted) {
      const srcComments = this.comments.get(h.key);
      if (srcComments) {
        mergedComments.push(...srcComments);
      }
    }

    // 10. Generate or use provided title (validate before any mutation)
    const mergedTitle = input.new_title || generateTitle(mergedSummary);

    const titleValidation = validateTitle(mergedTitle, this.config);
    if (!titleValidation.valid) {
      return { success: false, error: titleValidation.error };
    }

    // 11. Build merged handoff (before any mutation to ensure rollback safety)
    const mergedMessageCount = splitConversationMessages(mergedConversation).length;
    const mergedConversationBytes =
      convValidation.inputSizes?.conversationBytes ?? Buffer.byteLength(mergedConversation, "utf8");

    const mergedHandoff: Handoff = {
      key: mergedKey,
      title: mergedTitle,
      from_ai: mergedFromAi,
      from_project: mergedFromProject,
      created_at: new Date().toISOString(),
      summary: mergedSummary,
      conversation: mergedConversation,
      message_count: mergedMessageCount,
      conversation_bytes: mergedConversationBytes,
      status: "active",
    };

    // 12. Delete sources if requested (after validation, before save to free capacity)
    if (input.delete_sources) {
      for (const key of input.keys) {
        const src = this.handoffs.get(key);
        if (src) this.cachedTotalBytes -= this.handoffBytes(src);
        this.handoffs.delete(key);
        this.comments.delete(key);
      }
    }

    // 13. FIFO capacity check for new key (protect source keys when delete_sources=false)
    const isNewKey = !this.handoffs.has(mergedKey);
    if (isNewKey && this.handoffs.size >= this.config.maxHandoffs) {
      const protectedKeys = input.delete_sources ? new Set<string>() : keySet;
      this.deleteOldestHandoff(protectedKeys);
    }

    // 14. Subtract old bytes if overwriting existing key
    const existingMergeTarget = this.handoffs.get(mergedKey);
    if (existingMergeTarget) this.cachedTotalBytes -= this.handoffBytes(existingMergeTarget);

    // 15. Save merged handoff (all validation passed, safe to mutate)
    this.handoffs.set(mergedKey, mergedHandoff);
    this.cachedTotalBytes += this.handoffBytes(mergedHandoff);

    // Set merged comments (if any)
    if (mergedComments.length > 0) {
      this.comments.set(mergedKey, mergedComments);
    }

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

  /**
   * Add a comment to a handoff.
   * @param key - Handoff key
   * @param author - Comment author name
   * @param content - Comment content
   * @returns Result with the created comment or error
   */
  async addComment(key: string, author: string, content: string): Promise<StorageResult<Comment>> {
    if (!this.handoffs.has(key)) {
      return { success: false, error: `Handoff not found: "${key}"` };
    }

    // Validate content
    if (!content || content.trim().length === 0) {
      return { success: false, error: "Comment content cannot be empty" };
    }
    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes > this.config.maxCommentBytes) {
      return {
        success: false,
        error: `Comment content exceeds maximum size (${this.config.maxCommentBytes} bytes)`,
      };
    }

    // Validate and normalize author
    const normalizedAuthor = !author || author.trim().length === 0 ? "anonymous" : author;
    if (normalizedAuthor.length > this.config.maxCommentAuthorLength) {
      return {
        success: false,
        error: `Author name exceeds maximum length (${this.config.maxCommentAuthorLength} chars)`,
      };
    }

    const existing = this.comments.get(key) ?? [];
    if (existing.length >= this.config.maxCommentsPerHandoff) {
      return {
        success: false,
        error: `Maximum comments per handoff reached (${this.config.maxCommentsPerHandoff})`,
      };
    }

    this.commentCounter++;
    const comment: Comment = {
      id: `c-${this.commentCounter}`,
      author: normalizedAuthor,
      content,
      created_at: new Date().toISOString(),
    };

    existing.push(comment);
    this.comments.set(key, existing);

    return { success: true, data: comment };
  }

  /**
   * Delete a comment from a handoff.
   * @param key - Handoff key
   * @param commentId - Comment ID to delete
   * @returns Result with success message or error
   */
  async deleteComment(key: string, commentId: string): Promise<StorageResult<{ message: string }>> {
    if (!this.handoffs.has(key)) {
      return { success: false, error: `Handoff not found: "${key}"` };
    }

    const existing = this.comments.get(key);
    if (!existing) {
      return { success: false, error: `Comment not found: "${commentId}"` };
    }

    const index = existing.findIndex((c) => c.id === commentId);
    if (index === -1) {
      return { success: false, error: `Comment not found: "${commentId}"` };
    }

    existing.splice(index, 1);
    return { success: true, data: { message: `Comment deleted: "${commentId}"` } };
  }
}
