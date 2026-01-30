/**
 * @file Handoff Viewer - シンプル版（ontoolresultでデータ受信）
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface HandoffSummary {
  key: string;
  title: string;
  from_ai: string;
  created_at: string;
}

const app = new App({ name: "Handoff Viewer", version: "1.0.0" });

// State
let handoffs: HandoffSummary[] = [];

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
        <div class="title">${escapeHtml(h.title)}</div>
        <div class="meta">${escapeHtml(h.from_ai)} | ${formatDate(h.created_at)}</div>
      </div>
    `
    )
    .join("");
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
