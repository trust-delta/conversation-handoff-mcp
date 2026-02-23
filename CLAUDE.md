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
  → index.ts (ツール登録・Zodスキーマ)
    → storage.ts の getStorage() → Storage インターフェース
      → LocalStorage (in-memory Map) ... standalone / HTTP server 内部
      → RemoteStorage (HTTP client) ... auto-connect / explicit server 指定時
        → server.ts (HTTPサーバー) → LocalStorage
```

### 起動モード分岐 (src/index.ts)

`--serve` フラグで分岐:

- **MCPモード（デフォルト）**: `@modelcontextprotocol/sdk`のStdioServerTransportでMCPサーバーとして起動
- **HTTPサーバーモード（`--serve`）**: `server.ts`のHTTPサーバーを単独起動

MCPモードでのストレージ選択（`getStorage()`）:

- `HANDOFF_SERVER=none` → LocalStorage（standalone）
- `HANDOFF_SERVER=<url>` → RemoteStorage（明示的接続）
- 未指定（デフォルト） → autoconnect.tsでポート1099-1200をスキャン → 見つかればRemoteStorage、なければサーバーを自動起動してRemoteStorage

### Storage Interface パターン (src/storage.ts)

`LocalStorage`と`RemoteStorage`は同一の`Storage`インターフェース（save/list/load/clear/stats/merge）を実装:

- **LocalStorage**: `Map<string, Handoff>`ベース。FIFO自動削除（容量上限時に最古を削除）。シングルトン
- **RemoteStorage**: HTTPクライアント。接続失敗時に`attemptReconnect()`でポート再スキャン→サーバー再起動。save失敗時は`pendingContent`でデータ復旧可能
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

### バリデーション (src/validation.ts)

- `HANDOFF_*`環境変数から設定を`parseEnvInt()`で安全にパース（不正値はデフォルトにフォールバック）
- バリデーション結果に`inputSizes`を含め、後続処理での`Buffer.byteLength`再計算を回避
- 予約キー: `"merge"`（APIルートと競合するため使用不可）

---

## リリース

1. `package.json`のバージョン更新
2. `CHANGELOG.md`更新
3. `README.md` / `README.ja.md`更新（新機能の説明追加）
4. feature branch → `main`へPR作成・マージ
5. `npm publish`
6. [Glama.ai](https://glama.ai/mcp/servers/@trust-delta/conversation-handoff-mcp)で「Sync server」を実行（自動更新されないため）
