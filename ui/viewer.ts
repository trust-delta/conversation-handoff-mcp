/**
 * @file Handoff Viewer - シンプル版（ontoolresultでデータ受信）
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface HandoffSummary {
  key: string;
  title: string;
  summary: string;
  from_ai: string;
  from_project: string;
  created_at: string;
  comment_count: number;
}

interface CommentData {
  id: string;
  author: string;
  content: string;
  created_at: string;
}

const app = new App({ name: "Handoff List", version: "0.7.1" });

// State
let handoffs: HandoffSummary[] = [];
const conversationCache: Map<string, string> = new Map();
const commentsCache: Map<string, CommentData[]> = new Map();

// DOM
const listEl = document.getElementById("list")!;
const statusEl = document.getElementById("status")!;

/**
 * HTMLエスケープ
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 日付フォーマット
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString();
}

/**
 * リスト描画
 */
function renderList(): void {
  if (handoffs.length === 0) {
    listEl.innerHTML = '<div class="empty">No handoffs</div>';
    return;
  }

  listEl.innerHTML = handoffs
    .map(
      (h) => `
      <div class="card" data-key="${escapeHtml(h.key)}">
        <div class="card-header">
          <div class="card-content">
            <div class="title">${escapeHtml(h.title)}${h.comment_count > 0 ? ` <span class="comment-badge">${h.comment_count}</span>` : ""}</div>
            <div class="meta">${escapeHtml(h.from_ai)} | ${formatDate(h.created_at)}</div>
          </div>
          <div class="card-actions">
            <button class="btn-card btn-expand" data-key="${escapeHtml(h.key)}">View</button>
            <button class="btn-card btn-load" data-key="${escapeHtml(h.key)}">Load</button>
            <button class="btn-card btn-delete" data-key="${escapeHtml(h.key)}">Delete</button>
          </div>
        </div>
        <div class="card-details">
          <div class="summary">${escapeHtml(h.summary)}</div>
          <div class="conversation" data-key="${escapeHtml(h.key)}">
            <div class="loading">Loading...</div>
          </div>
          <div class="comments-section" data-key="${escapeHtml(h.key)}"></div>
        </div>
      </div>
    `
    )
    .join("");

  // 展開ボタンのイベント登録
  listEl.querySelectorAll(".btn-expand").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = (btn as HTMLElement).dataset.key;
      if (key) {
        const card = listEl.querySelector(`.card[data-key="${key}"]`) as HTMLElement;
        if (card) toggleCard(card);
      }
    });
  });

  // 削除ボタンのイベント登録
  listEl.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = (btn as HTMLElement).dataset.key;
      if (key) deleteHandoff(key);
    });
  });

  // Loadボタンのイベント登録
  listEl.querySelectorAll(".btn-load").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = (btn as HTMLElement).dataset.key;
      if (key) loadHandoff(key);
    });
  });
}

/**
 * カード展開/折り畳みトグル
 */
async function toggleCard(card: HTMLElement): Promise<void> {
  const key = card.dataset.key;
  if (!key) return;

  const wasExpanded = card.classList.contains("expanded");

  // 他のカードを閉じる
  listEl.querySelectorAll(".card.expanded").forEach((c) => {
    c.classList.remove("expanded");
  });

  // 開いていたカードをクリックした場合は閉じるだけ
  if (wasExpanded) return;

  // 展開
  card.classList.add("expanded");

  // 会話とコメントを読み込み
  await loadConversation(key);
}

/**
 * structuredContent からの会話データ型
 */
interface HandoffStructuredContent {
  key: string;
  title: string;
  summary: string;
  conversation: string;
  from_ai: string;
  from_project: string;
  created_at: string;
  comments?: CommentData[];
}

/**
 * 会話読み込み
 */
async function loadConversation(key: string): Promise<void> {
  const convEl = listEl.querySelector(`.conversation[data-key="${key}"]`);
  if (!convEl) return;

  // キャッシュがあれば使う
  if (conversationCache.has(key)) {
    renderConversation(convEl as HTMLElement, conversationCache.get(key)!);
    renderCommentsSection(key, commentsCache.get(key) ?? []);
    return;
  }

  convEl.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const result = await app.callServerTool({ name: "handoff_load", arguments: { key } });

    // structuredContentを優先利用（テキストパースはフォールバック）
    const structured = (result as { structuredContent?: HandoffStructuredContent })?.structuredContent;
    let conversation: string;
    let comments: CommentData[] = [];

    if (structured?.conversation) {
      conversation = structured.conversation;
      comments = structured.comments ?? [];
    } else {
      // フォールバック: テキストからパース
      const content = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text || "";
      const match = content.match(/## Conversation\n([\s\S]*)/);
      conversation = match ? match[1].trim() : content;
    }

    conversationCache.set(key, conversation);
    commentsCache.set(key, comments);
    renderConversation(convEl as HTMLElement, conversation);
    renderCommentsSection(key, comments);
  } catch (err) {
    convEl.innerHTML = `<div class="loading">Error: ${escapeHtml(String(err))}</div>`;
  }
}

/**
 * コメントセクション描画
 */
function renderCommentsSection(key: string, comments: CommentData[]): void {
  const sectionEl = listEl.querySelector(`.comments-section[data-key="${key}"]`) as HTMLElement;
  if (!sectionEl) return;

  const commentsHtml = comments.length > 0
    ? comments
        .map(
          (c) => `
          <div class="comment" data-comment-id="${escapeHtml(c.id)}">
            <div class="comment-header">
              <span class="comment-author">${escapeHtml(c.author)}</span>
              <span class="comment-date">${formatDate(c.created_at)}</span>
              <button class="btn-comment-delete" data-key="${escapeHtml(key)}" data-comment-id="${escapeHtml(c.id)}">x</button>
            </div>
            <div class="comment-content">${escapeHtml(c.content)}</div>
          </div>
        `
        )
        .join("")
    : "";

  sectionEl.innerHTML = `
    <div class="comments-header">Comments (${comments.length})</div>
    ${commentsHtml}
    <div class="comment-form">
      <textarea class="comment-input" data-key="${escapeHtml(key)}" placeholder="Add a comment..." rows="2"></textarea>
      <button class="btn-card btn-add-comment" data-key="${escapeHtml(key)}">Add Comment</button>
    </div>
  `;

  // 削除ボタンイベント
  sectionEl.querySelectorAll(".btn-comment-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const k = (btn as HTMLElement).dataset.key;
      const cId = (btn as HTMLElement).dataset.commentId;
      if (k && cId) await deleteComment(k, cId);
    });
  });

  // 追加ボタンイベント
  const addBtn = sectionEl.querySelector(".btn-add-comment");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      const k = (addBtn as HTMLElement).dataset.key;
      const textarea = sectionEl.querySelector(`.comment-input[data-key="${k}"]`) as HTMLTextAreaElement;
      if (k && textarea && textarea.value.trim()) {
        await addComment(k, textarea.value.trim());
        textarea.value = "";
      }
    });
  }
}

/**
 * コメント追加
 */
async function addComment(key: string, content: string): Promise<void> {
  try {
    const result = await app.callServerTool({
      name: "handoff_add_comment",
      arguments: { key, content },
    });
    // キャッシュクリアして再読み込み
    conversationCache.delete(key);
    commentsCache.delete(key);
    await loadConversation(key);
    await refreshList();
  } catch (err) {
    statusEl.textContent = `Error: ${err}`;
  }
}

/**
 * コメント削除
 */
async function deleteComment(key: string, commentId: string): Promise<void> {
  try {
    await app.callServerTool({
      name: "handoff_delete_comment",
      arguments: { key, comment_id: commentId },
    });
    // キャッシュクリアして再読み込み
    conversationCache.delete(key);
    commentsCache.delete(key);
    await loadConversation(key);
    await refreshList();
  } catch (err) {
    statusEl.textContent = `Error: ${err}`;
  }
}

/**
 * 会話を描画
 */
function renderConversation(el: HTMLElement, conversation: string): void {
  // ## User / ## Assistant でパース
  const messages = parseConversation(conversation);

  if (messages.length === 0) {
    el.innerHTML = '<div class="loading">No messages</div>';
    return;
  }

  el.innerHTML = messages
    .map(
      (m) => `
      <div class="message">
        <div class="message-role ${m.role}">${m.role === "user" ? "User" : "Assistant"}</div>
        <div class="message-content">${escapeHtml(m.content)}</div>
      </div>
    `
    )
    .join("");
}

/**
 * 会話パース
 */
function parseConversation(text: string): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  const parts = text.split(/^## (User|Assistant)\s*$/im);

  for (let i = 1; i < parts.length; i += 2) {
    const role = parts[i].toLowerCase() as "user" | "assistant";
    const content = (parts[i + 1] || "").trim();
    if (content) {
      messages.push({ role, content });
    }
  }

  return messages;
}

/**
 * ハンドオフをLLMに読み込ませる
 */
async function loadHandoff(key: string): Promise<void> {
  statusEl.textContent = "Loading handoff...";
  try {
    const result = await app.callServerTool({ name: "handoff_load", arguments: { key } });
    const structured = (result as { structuredContent?: HandoffStructuredContent })?.structuredContent;

    if (structured) {
      // コンテキスト全体をメッセージとして送信
      const message = `以下の会話ハンドオフをロードしました。このコンテキストを引き継いで会話を続けてください。

# ${structured.title}

**From:** ${structured.from_ai} | **Project:** ${structured.from_project} | **Created:** ${structured.created_at}

## サマリー
${structured.summary}

## 会話履歴
${structured.conversation}`;

      await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: message }]
      });
      statusEl.textContent = "Handoff inserted - press Enter to send";
    } else {
      statusEl.textContent = "Failed to load handoff";
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err}`;
  }
}

/**
 * ハンドオフ削除
 */
async function deleteHandoff(key: string): Promise<void> {
  statusEl.textContent = "Deleting...";
  try {
    await app.callServerTool({ name: "handoff_clear", arguments: { key } });
    await refreshList();
  } catch (err) {
    statusEl.textContent = `Error: ${err}`;
  }
}

/**
 * リスト再取得
 */
async function refreshList(): Promise<void> {
  statusEl.textContent = "Refreshing...";
  try {
    const result = await app.callServerTool({ name: "handoff_list", arguments: {} });
    // structuredContentからhandoffsを取得
    const data = (result as { structuredContent?: { handoffs?: HandoffSummary[] } })?.structuredContent;
    if (data?.handoffs) {
      handoffs = data.handoffs;
      renderList();
      statusEl.textContent = `${handoffs.length} handoffs`;
    } else {
      handoffs = [];
      renderList();
      statusEl.textContent = "No handoffs";
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err}`;
  }
}

// ハンドラ登録
app.ontoolinput = (params) => {
  console.log("[viewer] ontoolinput:", params);
  statusEl.textContent = "Loading...";
};

app.ontoolresult = (result) => {
  console.log("[viewer] ontoolresult:", result);
  const data = result.structuredContent as { handoffs?: HandoffSummary[] } | undefined;
  if (data?.handoffs) {
    handoffs = data.handoffs;
    renderList();
    statusEl.textContent = `${handoffs.length} handoffs`;
  }
};

app.onerror = (error) => {
  console.error("[viewer] error:", error);
  statusEl.textContent = "Error: " + error;
};

// 接続
app.connect().then(() => {
  console.log("[viewer] Connected");
  statusEl.textContent = "Waiting for data...";
}).catch((err) => {
  console.error("[viewer] Connection failed:", err);
  statusEl.textContent = "Failed: " + err;
});
