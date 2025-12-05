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

## 共有サーバーモード (v0.3.0+)

複数のMCPクライアント（Claude Desktop、Claude Code など）間でhandoffを共有できます。

### 動作モード

v0.3.0から、MCPクライアントは**リクエストごとに**ローカルサーバー（`localhost:1099`）への接続を確認します：

| 状態 | 動作 |
|------|------|
| サーバーが起動している | 共有モード（handoffを共有） |
| サーバーが起動していない | スタンドアロンモード（警告付き） |
| `HANDOFF_SERVER=none` | スタンドアロンモード（警告なし） |

**動的モード切り替え:**
- 途中でサーバーを起動 → 次のリクエストから自動で共有モードに切り替わる
- サーバーが落ちた → 次のリクエストでスタンドアロンにフォールバック
- スタンドアロンで保存したデータは、モード切り替え後も保持される

### スタンドアロンモードの制約

スタンドアロンモードでは、handoffデータはMCPサーバープロセスのメモリ内に保存されます。

**可能なこと:**
- 同一アプリ内での会話・プロジェクト間の引き継ぎ（例: Claude Desktopの異なるプロジェクト間）

**できないこと:**
- 異なるアプリ間での引き継ぎ（例: Claude Desktop → Claude Code）
- 異なるプロセス間での引き継ぎ

複数のMCPクライアント間でhandoffを共有するには、共有サーバーを起動してください。

### 共有サーバーの起動

```bash
# デフォルトポート (1099)
npx conversation-handoff-mcp --serve

# カスタムポート
npx conversation-handoff-mcp --serve --port 3000
```

### MCPクライアントの設定

**標準設定（推奨）** - サーバーが利用可能な場合は自動接続：

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

**カスタムサーバー(ポート)を指定：**

```json
{
  "mcpServers": {
    "conversation-handoff": {
      "command": "npx",
      "args": ["-y", "conversation-handoff-mcp"],
      "env": {
        "HANDOFF_SERVER": "http://localhost:3000"
      }
    }
  }
}
```

**常にスタンドアロンモード（共有サーバーを使用しない）：**

```json
{
  "mcpServers": {
    "conversation-handoff": {
      "command": "npx",
      "args": ["-y", "conversation-handoff-mcp"],
      "env": {
        "HANDOFF_SERVER": "none"
      }
    }
  }
}
```

### HTTPエンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| POST | /handoff | handoffを保存 |
| GET | /handoff | handoff一覧を取得 |
| GET | /handoff/:key | 特定のhandoffを取得 |
| DELETE | /handoff/:key | 特定のhandoffを削除 |
| DELETE | /handoff | 全handoffを削除 |
| GET | /stats | ストレージ統計を取得 |
| GET | / | ヘルスチェック |

### 使用例

1. 共有サーバーを起動:
   ```bash
   npx conversation-handoff-mcp --serve
   ```

2. Claude Desktop でhandoffを保存:
   ```
   handoff_save(key: "my-task", title: "タスク名", summary: "...", conversation: "...")
   ```

3. Claude Code（または別のクライアント）でhandoffを読み込み:
   ```
   handoff_load(key: "my-task")
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
