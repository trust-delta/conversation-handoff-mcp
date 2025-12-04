# conversation-handoff-mcp

[![npm version](https://img.shields.io/npm/v/conversation-handoff-mcp.svg)](https://www.npmjs.com/package/conversation-handoff-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/trust-delta/conversation-handoff-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/trust-delta/conversation-handoff-mcp/actions/workflows/ci.yml)

AIチャット間、または同AIの異なるプロジェクト間で会話コンテキストを引き継ぐためのMCPサーバー。

[English Documentation](README.md)

## 特徴

- **メモリベース**: 一時的なクリップボードとして動作（サーバー再起動で消える）
- **共通フォーマット**: Markdown形式で人間も読める
- **軽量API**: リスト取得時はsummaryのみ返してコンテキスト節約

## インストール

### npm経由（推奨）

```bash
npm install -g conversation-handoff-mcp
```

### ローカルビルド

```bash
git clone https://github.com/trust-delta/conversation-handoff-mcp.git
cd conversation-handoff-mcp
npm install
npm run build
```

## MCP クライアント設定

Claude Desktop、Claude Code、Codex CLI、Gemini CLI など各種MCPクライアントで使用できます。

### 設定ファイルの場所

| クライアント | 設定ファイル |
|-------------|-------------|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `~/.claude/settings.json` |
| Codex CLI | `~/.codex/config.toml` |
| Gemini CLI | `~/.gemini/settings.json` |
| Cursor | `~/.cursor/mcp.json` |
| ChatGPT Desktop | アプリ内設定（Developer Mode） |

### npx経由（インストール不要）

```json
{
  "mcpServers": {
    "conversation-handoff": {
      "command": "npx",
      "args": ["-y", "conversation-handoff-mcp"]
    }
  }
}
```

### ローカルビルド版を使用

```json
{
  "mcpServers": {
    "conversation-handoff": {
      "command": "node",
      "args": ["/path/to/conversation-handoff-mcp/dist/index.js"]
    }
  }
}
```

> **Note**: Codex CLI は TOML 形式です。詳細は [Codex MCP ドキュメント](https://developers.openai.com/codex/mcp/) を参照してください。

## ツール

### handoff_save

会話コンテキストを保存。

```text
handoff_save(
  key: "project-design",
  title: "プロジェクト設計の議論",
  summary: "MCPサーバーの設計方針を決定した",
  conversation: "## User\n質問...\n\n## Assistant\n回答..."
)
```

### handoff_list

保存済みの引き継ぎ一覧を取得（summaryのみ）。

```text
handoff_list()
```

### handoff_load

特定の引き継ぎを全文取得。

```text
handoff_load(key: "project-design")
handoff_load(key: "project-design", max_messages: 10)  // 最新10件のみ
```

### handoff_clear

引き継ぎを削除。

```text
handoff_clear(key: "project-design")  // 特定のキー
handoff_clear()  // 全削除
```

### handoff_stats

ストレージの使用状況と制限値を確認。

```text
handoff_stats()
```

## 設定

環境変数で制限値をカスタマイズできます。

| 環境変数 | デフォルト値 | 説明 |
|----------|--------------|------|
| `HANDOFF_MAX_COUNT` | 100 | 最大保存数 |
| `HANDOFF_MAX_CONVERSATION_BYTES` | 1048576 (1MB) | 会話の最大サイズ |
| `HANDOFF_MAX_SUMMARY_BYTES` | 10240 (10KB) | サマリーの最大サイズ |
| `HANDOFF_MAX_TITLE_LENGTH` | 200 | タイトルの最大文字数 |
| `HANDOFF_MAX_KEY_LENGTH` | 100 | キーの最大文字数 |

### 設定例（Claude Desktop）

```json
{
  "mcpServers": {
    "conversation-handoff": {
      "command": "npx",
      "args": ["-y", "conversation-handoff-mcp"],
      "env": {
        "HANDOFF_MAX_COUNT": "50",
        "HANDOFF_MAX_CONVERSATION_BYTES": "524288"
      }
    }
  }
}
```

## 会話フォーマット

```markdown
## User
ユーザーのメッセージ

## Assistant
AIの回答
```

## ライセンス

MIT

## 作者

trust-delta
