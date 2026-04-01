// =============================================================================
// Shared type definitions for storage layer
// =============================================================================

import type { InputSizes } from "./validation.js";

/** A comment attached to a handoff */
export interface Comment {
  id: string;
  author: string;
  content: string;
  created_at: string;
}

/** Valid handoff status values */
export type HandoffStatus = "active" | "completed" | "pending";

export interface Handoff {
  key: string;
  title: string;
  from_ai: string;
  from_project: string;
  created_at: string;
  summary: string;
  conversation: string;
  /** Comments attached to this handoff (populated on load) */
  comments?: Comment[];
  /** Number of messages in the conversation */
  message_count?: number;
  /** Byte size of the conversation content */
  conversation_bytes?: number;
  /** Current status of the handoff */
  status?: HandoffStatus;
  /** Suggested next action for the receiver */
  next_action?: string;
  /** Tags for categorizing and searching handoffs */
  tags?: string[];
}

export interface HandoffSummary {
  key: string;
  title: string;
  from_ai: string;
  from_project: string;
  created_at: string;
  summary: string;
  comment_count: number;
  /** Number of messages in the conversation */
  message_count?: number;
  /** Byte size of the conversation content */
  conversation_bytes?: number;
  /** Current status of the handoff */
  status?: HandoffStatus;
  /** Suggested next action for the receiver */
  next_action?: string;
  /** Tags for categorizing and searching handoffs */
  tags?: string[];
}

export interface SaveInput {
  key: string;
  title: string;
  summary: string;
  conversation: string;
  from_ai: string;
  from_project: string;
  /** Number of messages in the conversation (auto-calculated if omitted) */
  message_count?: number;
  /** Byte size of the conversation content (auto-calculated if omitted) */
  conversation_bytes?: number;
  /** Current status of the handoff */
  status?: HandoffStatus;
  /** Suggested next action for the receiver */
  next_action?: string;
  /** Tags for categorizing and searching handoffs */
  tags?: string[];
}

/** Search criteria for finding handoffs */
export interface SearchInput {
  /** Find handoffs with ANY of these tags */
  tags?: string[];
  /** Find handoffs with ALL of these tags */
  tags_all?: string[];
  /** Text search in title and summary (case-insensitive substring) */
  query?: string;
  /** Filter by exact project name */
  from_project?: string;
  /** Filter by exact AI name */
  from_ai?: string;
  /** Filter by status */
  status?: HandoffStatus;
  /** Only handoffs created after this ISO date */
  created_after?: string;
  /** Only handoffs created before this ISO date */
  created_before?: string;
  /** Max results to return (default: 20, max: 100) */
  limit?: number;
}

export interface StorageStats {
  current: {
    handoffs: number;
    totalComments: number;
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
  /** Metadata from validation (e.g., pre-calculated byte sizes) */
  metadata?: { inputSizes?: InputSizes };
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
  search(input: SearchInput): Promise<StorageResult<HandoffSummary[]>>;
  addComment(key: string, author: string, content: string): Promise<StorageResult<Comment>>;
  deleteComment(key: string, commentId: string): Promise<StorageResult<{ message: string }>>;
}

export type StorageMode = "shared" | "standalone" | "standalone-explicit";

export interface GetStorageResult {
  storage: Storage;
  mode: StorageMode;
  serverUrl?: string;
  autoStarted?: boolean;
}
