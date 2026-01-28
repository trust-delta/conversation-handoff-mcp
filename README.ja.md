# conversation-handoff-mcp

[![npm version](https://img.shields.io/npm/v/conversation-handoff-mcp.svg)](https://www.npmjs.com/package/conversation-handoff-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/trust-delta/conversation-handoff-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/trust-delta/conversation-handoff-mcp/actions/workflows/ci.yml)

<a href="https://glama.ai/mcp/servers/@trust-delta/conversation-handoff-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@trust-delta/conversation-handoff-mcp/badge" />
</a>

AIチャット間、または同AIの異なるプロジェクト間で会話コンテキストを引き継ぐためのMCPサーバー。

[English Documentation](README.md)

## 特徴

- **オートコネクト (v0.4.0+)**: サーバーがバックグラウンドで自動起動 - 手動設定不要
- **自動再接続 (v0.4.0+)**: サーバーダウン時に自動復旧 - ユーザー介入不要
- **メモリベースストレージ**: 軽量な一時クリップボード設計 - ファイルを一切使わない
- **共通フォーマット**: Markdown形式で人間も読める
- **軽量API**: リスト取得時はsummaryのみ返してコンテキスト節約
- **キー自動生成 (v0.4.0+)**: `handoff_save`でkey/titleが省略可能に

## インストール

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

### npm経由（推奨）

npxで実行するため、事前インストールは不要です。

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

グローバルインストールする場合：

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

MCP設定：

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

会話コンテキストを保存。key/titleは省略すると自動生成されます (v0.4.0+)。

```text
// keyとtitleを明示的に指定
handoff_save(
  key: "project-design",
  title: "プロジェクト設計の議論",
  summary: "MCPサーバーの設計方針を決定した",
  conversation: "## User\n質問...\n\n## Assistant\n回答..."
)

// key/titleを自動生成 (v0.4.0+)
handoff_save(
  summary: "MCPサーバーの設計方針を決定した",
  conversation: "## User\n質問...\n\n## Assistant\n回答..."
)
// → key: "handoff-20241208-143052-abc123" (タイムスタンプ+ランダム)
// → title: "MCPサーバーの設計方針を決定した" (summaryから生成)
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

## オートコネクトモード (v0.4.0+)

v0.4.0から、MCPクライアント接続時にサーバーが**バックグラウンドで自動起動**します。
もう手動設定は不要です！

### 動作の仕組み

```
[ユーザーがClaude Desktopを起動]
  → MCPクライアント起動
  → ポート1099-1200を並列スキャンして既存サーバーを探索
  → サーバーが見つからない場合: バックグラウンドで自動起動
  → サーバーに接続
  → (ユーザーは何も気づかない - 自動で動作！)

[後でClaude Codeを起動]
  → MCPクライアント起動
  → ポート1099-1200を並列スキャン
  → 既存サーバーを発見
  → 同じサーバーに接続
  → handoffが共有される！
```

### 動作モード

| モード | 条件 | 動作 |
|--------|------|------|
| オートコネクト（デフォルト） | `HANDOFF_SERVER`未設定 | サーバーを自動検出/起動 |
| 明示的サーバー | `HANDOFF_SERVER=http://...` | 指定URLに接続 |
| スタンドアロン | `HANDOFF_SERVER=none` | サーバーなし、メモリのみ |

### メモリベースストレージ

handoffデータは**メモリのみ**に保存されます：

- HTTPサーバー経由で接続中の全MCPクライアント間でデータを共有
- サーバープロセス終了時にデータは消失
- ディスクにファイルを一切書き込まない - 軽量でクリーン
- アクティブなセッション中の一時的なコンテキスト共有に最適
- **FIFO自動削除**: 上限到達時に最古のhandoffを自動削除（エラーなし）

### 自動再接続

共有サーバーが運用中にダウンした場合：

```
[サーバーが予期せず停止]
  → ユーザーが handoff_save() を呼び出し
  → リクエスト失敗（接続拒否）
  → 自動再接続が作動:
    → ポート1099-1200を再スキャンして既存サーバーを探索
    → 見つかった場合: そのサーバーに接続
    → 見つからない場合: 新しいサーバーをバックグラウンドで起動
  → 元のリクエストをリトライ
  → ユーザーには成功が表示される（透過的に復旧！）
```

- リトライ上限は `HANDOFF_RETRY_COUNT` で設定可能（デフォルト: 30）
- 最終的に失敗した場合: 引き継ぎ内容を出力（手動復旧用）
- 他のMCPクライアントは次のリクエスト時に新しいサーバーを自動検出

### サーバー自動終了（TTL）

サーバーは一定時間リクエストがない場合に自動終了します：

- デフォルト: 24時間リクエストがなければ終了
- `HANDOFF_SERVER_TTL` 環境変数で設定可能
- `0` に設定すると自動終了を無効化
- 次回のMCPクライアントリクエスト時に新しいサーバーが自動起動

### MCPクライアントの設定

**標準設定（推奨）** - オートコネクトで自動的に動作：

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

**カスタムサーバーを指定：**

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

**スタンドアロンモードを強制（サーバーなし）：**

Claude Desktop専用です。Claude Desktopは標準機能では異なるプロジェクト間で会話を引き継げませんが、単一アプリとしてメモリ空間を共有するため、このMCPサーバーで引き継ぎが可能になります。Claude CodeやCLIツールは各タブ/セッションが独立プロセスのため、このモードでは引き継ぎできません。

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

### 手動サーバー起動（オプション）

手動で制御したい場合：

```bash
# デフォルトポート (1099)
npx conversation-handoff-mcp --serve

# カスタムポート
npx conversation-handoff-mcp --serve --port 3000
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

**シナリオ: Claude Desktopで設計議論 → Claude Codeで実装**

1. **Claude Desktopで** - 設計を議論:
   ```
   ユーザー: アプリの認証システムを設計しよう。

   アシスタント: JWTとリフレッシュトークンを使った方式がおすすめです...
   [詳細な議論が続く]
   ```

2. **会話を保存** - 引き継ぎの準備ができたら:
   ```
   ユーザー: この会話をClaude Codeでの実装用に保存して。

   アシスタント: (handoff_saveを呼び出し)
   ✅ キー "auth-design-20241208" で保存しました
   ```

3. **Claude Codeで** - 読み込んで続行:
   ```
   ユーザー: 認証設計の議論を読み込んで。

   アシスタント: (handoff_loadを呼び出し)
   # Handoff: 認証システム設計
   [会話コンテキスト全体が読み込まれる]

   JWTとリフレッシュトークンについて議論されていますね。実装していきましょう...
   ```

**ポイント:**
- AIが自動的に会話をフォーマットして保存
- コードスニペットや決定事項を含むコンテキストが完全に保持される
- 手動でのコピペ不要

> **Note**: サーバーは最初のMCPクライアント接続時にバックグラウンドで自動起動します。手動で起動する必要はありません。

## 設定

環境変数で動作をカスタマイズできます。

### 接続設定 (v0.4.0+)

| 環境変数 | デフォルト値 | 説明 |
|----------|--------------|------|
| `HANDOFF_SERVER` | (自動) | `none`でスタンドアロン、または明示的サーバーURL |
| `HANDOFF_PORT_RANGE` | `1099-1200` | 自動検出のポート範囲 |
| `HANDOFF_RETRY_COUNT` | 30 | 自動再接続のリトライ回数 |
| `HANDOFF_RETRY_INTERVAL` | 10000 | 自動再接続の間隔 (ms) |
| `HANDOFF_SERVER_TTL` | 86400000 (24時間) | サーバー自動終了までの時間 (0で無効) |

### ストレージ制限

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
