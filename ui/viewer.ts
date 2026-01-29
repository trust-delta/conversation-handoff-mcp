import { App } from "@modelcontextprotocol/ext-apps";

interface HandoffSummary {
  key: string;
  title: string;
  summary: string;
  from_ai: string;
  from_project: string;
  created_at: string;
}

interface HandoffFull extends HandoffSummary {
  conversation: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const app = new App();

const handoffList = document.getElementById("handoffList") as HTMLDivElement;
const refreshBtn = document.getElementById("refreshBtn") as HTMLButtonElement;
const viewerHeader = document.getElementById("viewerHeader") as HTMLDivElement;
const viewerTitle = document.getElementById("viewerTitle") as HTMLHeadingElement;
const viewerMeta = document.getElementById("viewerMeta") as HTMLDivElement;
const viewerContent = document.getElementById("viewerContent") as HTMLDivElement;

let handoffs: HandoffSummary[] = [];
let selectedKey: string | null = null;

function parseConversation(markdown: string): Message[] {
  const messages: Message[] = [];
  const sections = markdown.split(/^##\s+/gm).filter(Boolean);

  for (const section of sections) {
    const lines = section.trim().split("\n");
    const header = lines[0]?.toLowerCase().trim() || "";
    const content = lines.slice(1).join("\n").trim();

    if (header.includes("user")) {
      messages.push({ role: "user", content });
    } else if (header.includes("assistant") || header.includes("claude")) {
      messages.push({ role: "assistant", content });
    }
  }
  return messages;
}

function renderHandoffList(): void {
  if (handoffs.length === 0) {
    handoffList.innerHTML = '<div class="empty">No handoffs saved</div>';
    return;
  }

  handoffList.innerHTML = handoffs.map(h => `
    <div class="handoff-card ${h.key === selectedKey ? 'active' : ''}" data-key="${h.key}">
      <h3>${escapeHtml(h.title)}</h3>
      <div class="meta">${h.from_ai} | ${formatDate(h.created_at)}</div>
    </div>
  `).join("");

  handoffList.querySelectorAll(".handoff-card").forEach(card => {
    card.addEventListener("click", () => {
      const key = card.getAttribute("data-key");
      if (key) loadHandoff(key);
    });
  });
}

function renderConversation(handoff: HandoffFull): void {
  viewerHeader.style.display = "block";
  viewerTitle.textContent = handoff.title;
  viewerMeta.textContent = `From: ${handoff.from_ai}${handoff.from_project ? ` (${handoff.from_project})` : ""} | ${formatDate(handoff.created_at)}`;

  const messages = parseConversation(handoff.conversation);
  if (messages.length === 0) {
    viewerContent.innerHTML = `<div class="message assistant"><div class="message-content">${escapeHtml(handoff.conversation)}</div></div>`;
    return;
  }

  viewerContent.innerHTML = messages.map(m => `
    <div class="message ${m.role}">
      <div class="message-header">${m.role === "user" ? "User" : "Assistant"}</div>
      <div class="message-content">${escapeHtml(m.content)}</div>
    </div>
  `).join("");
}

async function loadHandoffList(): Promise<void> {
  handoffList.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const result = await app.callServerTool("handoff_list", {});
    const text = result?.content?.[0]?.text;
    if (text && !text.includes("No handoffs")) {
      handoffs = JSON.parse(text) as HandoffSummary[];
    } else {
      handoffs = [];
    }
  } catch (e) {
    console.error("Failed to load handoffs:", e);
    handoffs = [];
  }
  renderHandoffList();
}

async function loadHandoff(key: string): Promise<void> {
  selectedKey = key;
  renderHandoffList();
  viewerContent.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const result = await app.callServerTool("handoff_load", { key });
    const text = result?.content?.[0]?.text;
    if (text) {
      // Parse the markdown response
      const titleMatch = text.match(/^# Handoff: (.+)$/m);
      const fromMatch = text.match(/\*\*From:\*\* (.+?)(?:\s*\((.+?)\))?$/m);
      const createdMatch = text.match(/\*\*Created:\*\* (.+)$/m);
      const summaryMatch = text.match(/## Summary\n([\s\S]*?)(?=\n## Conversation)/);
      const convMatch = text.match(/## Conversation\n([\s\S]*?)$/);

      const handoff: HandoffFull = {
        key,
        title: titleMatch?.[1] || key,
        from_ai: fromMatch?.[1] || "unknown",
        from_project: fromMatch?.[2] || "",
        created_at: createdMatch?.[1] || "",
        summary: summaryMatch?.[1]?.trim() || "",
        conversation: convMatch?.[1]?.trim() || text,
      };
      renderConversation(handoff);
    }
  } catch (e) {
    console.error("Failed to load handoff:", e);
    viewerContent.innerHTML = '<div class="empty">Failed to load handoff</div>';
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

// Event handlers
refreshBtn.addEventListener("click", loadHandoffList);

// Initialize
app.connect().then(() => {
  // Receive initial tool result (handoff list)
  app.ontoolresult = (result) => {
    try {
      const text = result?.content?.[0]?.text;
      if (text && !text.includes("No handoffs") && !text.includes("Error")) {
        handoffs = JSON.parse(text) as HandoffSummary[];
        renderHandoffList();
      }
    } catch {
      // Initial result might not be JSON, ignore
    }
  };

  // Load handoff list
  loadHandoffList();
});
