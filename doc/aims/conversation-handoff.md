---
aim: AIチャット間・プロジェクト間で会話コンテキストを手軽かつ安全に引き継ぐ軽量な汎用MCPサーバーを提供する
state: open
---

# IS

この aim を「**意図的に揮発的な軽量クリップボード**」として読む。永続ストレージではなく in-memory の揮発性を選び、手動セットアップではなく auto-connect を、構造化スキーマではなく人間可読な共通 Markdown を、そして handoff_load 出力のプロンプトインジェクション・マーカーを安全性の床として置く ── これにより「引き継ぐ」行為をほぼゼロ摩擦にし、特定の MCP クライアントに縛られない汎用性を保つ。

- **手軽**: auto-connect（ポート1099-1200スキャン→見つからなければ自動起動）・key/title 自動生成・list は要約のみ返しコンテキストを節約・npx ゼロインストール配布。
- **安全**: handoff_load 出力にセキュリティマーカー（プロンプトインジェクション対策）。SECURITY.md を持つ。
- **軽量**: memory-based（サーバー終了でデータ消失）。容量上限で FIFO 自動削除。永続化しないのは是正すべき制約ではなく**設計選択**。
- **汎用**: 単一 Storage インターフェース（Local in-memory / Remote HTTP client）・共通 Markdown 形式で多数の MCP クライアント（Claude Desktop / Code, Codex, Gemini, Cursor 等）に横断対応。

子目的（各クライアント対応・保存形式・セキュリティ強化・発見性・配布）への分解は operator が pin する（producer は提案して escalate）。

# PROCESS
- [done] 起動モード分岐（index.ts）: MCP（stdio, デフォルト） / HTTP（--serve）の二モード
- [done] Storage インターフェース: Local in-memory（Map・FIFO・シングルトン） / Remote HTTP client（再接続DI）、全操作 StorageResult を返す
- [done] コア操作: save / list / load / clear / stats / merge、verbatim 保存、key/title 自動生成
- [done] 安全: handoff_load セキュリティマーカー、監査ログ（JSONL, --audit / HANDOFF_AUDIT）
- [done] 発見性: tags メタデータ + handoff_search、list メタデータ（件数 / サイズ / status / next action）
- [done] 注釈: comments/annotations（handoff_add_comment 等）、サーバー再起動（handoff_restart）
- [done] 大規模会話の分割: handoff_append（v0.13.0）
- [done] 出荷後の currency 自動化: dependabot（npm + github-actions・週次・minor/patch グループ化）導入。非破壊 currency 一巡で脆弱性 11→0（PR #26）
- [done] major 追従: lint-staged 17 (#33) / biome 2 (#35, config v2 移行) / typescript 6 (#36, `types:["node"]`) / vite 8 (#37) を個別 PR で完了。@types/node は engines 床(>=20)に合わせ 20 据え置き
- [todo] dependabot PR のレビュー / マージ運用（継続的な保守 posture）— @types/node 26 提案は据え置き判断
