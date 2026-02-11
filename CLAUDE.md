# conversation-handoff-mcp

AI会話コンテキストを引き継ぐためのMCPサーバー。

## 開発コマンド

```bash
npm run build      # UIビルド + TypeScriptコンパイル
npm run dev        # TypeScript watchモード
npm run test       # テスト実行
npm run check      # Biome lint + format チェック
npm run check:fix  # 自動修正
```

## アーキテクチャ

```
src/
├── index.ts       # MCPサーバー本体、ツール定義
├── storage.ts     # LocalStorage / RemoteStorage
├── server.ts      # HTTPサーバー（共有モード用）
├── autoconnect.ts # 自動接続・再接続ロジック
├── validation.ts  # 入力バリデーション
└── audit.ts       # 構造化監査ログ（--audit モード）

ui/
├── viewer.html    # MCP Apps UI（エントリポイント）
└── viewer.ts      # UI実装
```

## MCP Apps UI

- `handoff_list`が`registerAppTool`で登録され、対応クライアントでUI表示
- UIは`ontoolresult`で`structuredContent`からデータを受信
- `callServerTool({ name: "ツール名", arguments: {} })`でサーバーツール呼び出し可能

## ビルド

UIは`vite-plugin-singlefile`で単一HTMLにバンドル:
```bash
npm run build:ui  # → dist/ui/viewer.html
```

## テスト

```bash
npm run test           # 全テスト
npm run test:watch     # watchモード
npm run test:coverage  # カバレッジ
```

## リリース

1. `package.json`のバージョン更新
2. `CHANGELOG.md`更新
3. `README.md` / `README.ja.md`更新（新機能の説明追加）
4. `develop` → `main`へPR作成・マージ
5. `npm publish`
6. [Glama.ai](https://glama.ai/mcp/servers/@trust-delta/conversation-handoff-mcp)で「Sync server」を実行（自動更新されないため）
