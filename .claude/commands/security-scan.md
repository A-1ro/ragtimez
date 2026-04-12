---
description: コードベース全体のセキュリティ脆弱性スキャンを実行する。引数でスキャン対象を絞り込み可能（例: /security-scan auth, /security-scan api）
---

# セキュリティスキャン

プロジェクト全体または指定領域のセキュリティ脆弱性を分析する。

## 引数

`$ARGUMENTS` でスキャン対象を指定可能:
- `/security-scan` — プロジェクト全体をスキャン
- `/security-scan auth` — 認証・セッション管理に特化
- `/security-scan api` — APIエンドポイント全体
- `/security-scan notes` — コミュニティノート機能
- `/security-scan newsletter` — ニュースレター機能
- `/security-scan deps` — 依存パッケージとGitHub Actions

## 手順

`security-scanner` エージェントを起動してセキュリティスキャンを実行する。

スキャン対象の指定がある場合（`$ARGUMENTS`が空でない場合）:
- `auth` → Phase 1（認証・セッション・管理者権限）に集中
- `api` → Phase 2-3（入力検証・API全エンドポイント）に集中  
- `notes` → `src/pages/api/notes/` と関連ファイルに集中
- `newsletter` → `src/pages/api/newsletter/` と `src/lib/newsletter.ts` に集中
- `deps` → Phase 5（依存パッケージ・GitHub Actions）に集中
- その他の文字列 → そのパスまたはキーワードに関連するファイルに集中

指定がない場合はプロジェクト全体（Phase 1-5）をスキャンする。

## 注意事項

- スキャン結果はCRITICAL/HIGH/MEDIUM/LOW/INFOの5段階で報告される
- 偽陽性を避けるため、必ずコードを読んでからデータフローを追跡して判断する
- 修正提案には具体的なコード例を含める
- 過去のスキャン結果はエージェントメモリに保存され、回帰検出に活用される
