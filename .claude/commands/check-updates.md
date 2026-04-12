---
description: 使用している技術に重要なアップデートがないかを調査する。引数で対象を絞り込み可能（例: /check-updates astro, /check-updates cloudflare）
---

# 技術アップデート調査

プロジェクトで使用している技術（依存パッケージ、プラットフォーム、ランタイム）に重要なアップデートがないかを調査する。

## 引数

`$ARGUMENTS` で調査対象を指定可能:
- `/check-updates` — 全技術を包括的に調査
- `/check-updates astro` — Astro フレームワークと関連パッケージに集中
- `/check-updates cloudflare` — Cloudflare (Workers, Pages, D1, KV, Wrangler) に集中
- `/check-updates security` — セキュリティ脆弱性と npm audit に集中
- `/check-updates deps` — npm 依存パッケージのバージョン確認のみ
- `/check-updates [パッケージ名]` — 指定パッケージに集中

## 手順

`tech-update-checker` エージェントを起動して技術アップデート調査を実行する。

調査対象の指定がある場合（`$ARGUMENTS` が空でない場合）:
- `astro` → Astro, @astrojs/cloudflare, @astrojs/rss に集中
- `cloudflare` → Wrangler, @cloudflare/workers-types, D1, KV, Workers AI に集中
- `security` → npm audit, CVE, サプライチェーンリスクに集中
- `deps` → npm outdated の結果を中心に簡潔に報告
- その他の文字列 → そのパッケージ名またはキーワードに関連する技術に集中

指定がない場合は Phase 1-5 の全調査を実行する。

## レポート

調査結果は以下の優先度で分類して日本語で報告される:
- 🔴 **緊急**: セキュリティ脆弱性、EOL、重大なバグ修正
- 🟡 **推奨**: 新機能、パフォーマンス改善、非推奨警告
- 🟢 **最新**: アップデート不要
- ℹ️ **情報**: プラットフォーム変更、エコシステムの動向

## 注意事項

- 調査にはインターネット接続が必要（npm registry、WebSearch）
- 破壊的変更がある場合は具体的な対応方法も提示される
- パッケージ間の互換性も考慮した推奨アップデート順序が提示される
