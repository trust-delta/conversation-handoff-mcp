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
}

const app = new App({ name: "Handoff List", version: "1.0.0" });

// State
let handoffs: HandoffSummary[] = [];
const conversationCache: Map<string, string> = new Map();

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
    .replace(/"/g, "&quot;");
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
            <div class="title">${escapeHtml(h.title)}</div>
            <div class="meta">${escapeHtml(h.from_ai)} | ${formatDate(h.created_at)}</div>
          </div>
          <div class="card-actions">
            <button class="btn-expand" data-key="${escapeHtml(h.key)}">View</button>
            <button class="btn-delete" data-key="${escapeHtml(h.key)}">Delete</button>
          </div>
        </div>
        <div class="card-details">
          <div class="summary">${escapeHtml(h.summary)}</div>
          <div class="conversation" data-key="${escapeHtml(h.key)}">
            <div class="loading">Loading...</div>
          </div>
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

  // 会話を読み込み
  await loadConversation(key);
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
    return;
  }

  convEl.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const result = await app.callServerTool({ name: "handoff_load", arguments: { key } });
    const content = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text || "";

    // 会話部分を抽出（## Conversation 以降）
    const match = content.match(/## Conversation\n([\s\S]*)/);
    const conversation = match ? match[1].trim() : content;

    conversationCache.set(key, conversation);
    renderConversation(convEl as HTMLElement, conversation);
  } catch (err) {
    convEl.innerHTML = `<div class="loading">Error: ${err}</div>`;
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
