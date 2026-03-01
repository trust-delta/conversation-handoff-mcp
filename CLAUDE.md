# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## プロジェクト概要

- **アプリケーション名**: conversation-handoff-mcp
- **プロジェクトタイプ**: MCPサーバー（npmパッケージ）
- AIチャット間（Claude Desktop ↔ Claude Code 等）や同AI内の異なるプロジェクト間で会話コンテキストを引き継ぐMCPサーバー
- ストレージはメモリベース（サーバー終了でデータ消失）。軽量な一時クリップボード設計
- handoff_loadの出力にはプロンプトインジェクション対策のセキュリティマーカーを含む

---

## ブランチ戦略

- **`main` ブランチには直接コミットしない**。必ず feature ブランチで作業すること
- コード変更を伴うタスクを開始する前に、まずブランチを作成する:
  ```bash
  git checkout -b <type>/<description>  # 例: feat/add-auth, fix/timeout-error, test/coverage
  ```
- PR は squash merge で `main` にマージする
- squash merge 後のローカル同期: `git checkout main && git fetch origin && git reset --hard origin/main`

---

## 開発コマンド

```bash
npm run build        # UIビルド (vite) + TypeScriptコンパイル
npm run dev          # TypeScript watchモード
npm run check        # Biome lint + format チェック
npm run check:fix    # Biome 自動修正
npm run typecheck    # 型チェック

# テスト (Vitest)
npm run test                          # 全テスト
npm run test:watch                    # watchモード
npm run test:coverage                 # カバレッジ
npx vitest src/storage.test.ts        # 単一ファイル
npx vitest -t "should save"           # テスト名でフィルタ
```

- pre-commitフック（husky + lint-staged）: `src/**/*.ts`に対し`biome check --write`が自動実行される

---

## コードスタイル

Biome設定（biome.json）:

- インデント: スペース2つ、行幅100文字
- ダブルクォート、セミコロン必須、ES5トレイリングカンマ
- `noUnusedVariables` / `noUnusedImports` はエラー

---

## アーキテクチャ

### 全体データフロー

```text
MCP Client (stdio)
  → index.ts (エントリポイント)
    → cli.ts (CLI引数解析)
    → tools.ts (ツール登録・Zodスキーマ)
      → storage.ts の getStorage() → Storage インターフェース
        → local-storage.ts (in-memory Map) ... standalone / HTTP server 内部
        → remote-storage.ts (HTTP client) ... auto-connect / explicit server 指定時
          → server.ts (HTTPサーバー) → LocalStorage
```

### ソースファイル構成 (src/)

| ファイル | 役割 |
|---------|------|
| `index.ts` | エントリポイント（MCP/HTTPモード分岐） |
| `cli.ts` | CLI引数解析・ヘルプ表示 |
| `tools.ts` | MCPツール登録・UIリソース・進捗通知 |
| `types.ts` | 共有型定義（Handoff, Storage interface等） |
| `config.ts` | 設定型・環境変数パース・デフォルト値 |
| `validation.ts` | バリデーション関数・ユーティリティ |
| `storage.ts` | 動的ストレージプロバイダ・再エクスポート |
| `local-storage.ts` | LocalStorage（in-memory Map）実装 |
| `remote-storage.ts` | RemoteStorage（HTTPクライアント）実装 |
| `autoconnect.ts` | サーバー自動検出・起動 |
| `server.ts` | HTTPサーバー実装 |
| `audit.ts` | 監査ログ（JSONL） |

**後方互換性**: `storage.ts`と`validation.ts`は分割先モジュールを再エクスポート。既存のimportはそのまま動作する。

### 起動モード分岐 (src/index.ts)

`--serve` フラグで分岐:

- **MCPモード（デフォルト）**: `@modelcontextprotocol/sdk`のStdioServerTransportでMCPサーバーとして起動
- **HTTPサーバーモード（`--serve`）**: `server.ts`のHTTPサーバーを単独起動

MCPモードでのストレージ選択（`getStorage()`）:

- `HANDOFF_SERVER=none` → LocalStorage（standalone）
- `HANDOFF_SERVER=<url>` → RemoteStorage（明示的接続）
- 未指定（デフォルト） → autoconnect.tsでポート1099-1200をスキャン → 見つかればRemoteStorage、なければサーバーを自動起動してRemoteStorage

### Storage Interface パターン

`LocalStorage`と`RemoteStorage`は同一の`Storage`インターフェース（save/list/load/clear/stats/merge）を実装:

- **LocalStorage** (`local-storage.ts`): `Map<string, Handoff>`ベース。FIFO自動削除（容量上限時に最古を削除）。シングルトン
- **RemoteStorage** (`remote-storage.ts`): HTTPクライアント。`reconnectFn`による再接続（DI）。save失敗時は`pendingContent`でデータ復旧可能
- 全操作は`StorageResult<T>`を返す（success, error?, suggestion?）

### MCP Apps UI (ui/)

- `handoff_list`のみ`registerAppTool`で登録 → 対応クライアントでUI表示
- `registerAppResource`で`dist/ui/viewer.html`を提供
- UIビルド: `vite-plugin-singlefile`で単一HTMLにバンドル（`npm run build:ui`）
- UI内から`callServerTool()`でサーバーツール呼び出し可能

### 監査ログ (src/audit.ts)

`--audit`フラグまたは`HANDOFF_AUDIT=true`で有効化:

- JSONL形式で`/tmp/conversation-handoff-mcp/`に出力
- カテゴリ: lifecycle, tool, storage, connection, http, validation, performance
- 10MBでファイルローテーション（最大5世代）
- 無効時はno-op（オーバーヘッドなし）

### 設定とバリデーション

- **config.ts**: `HANDOFF_*`環境変数から設定を`parseEnvInt()`で安全にパース（不正値はデフォルトにフォールバック）
- **validation.ts**: バリデーション結果に`inputSizes`を含め、後続処理での`Buffer.byteLength`再計算を回避。予約キー: `"merge"`（APIルートと競合するため使用不可）
