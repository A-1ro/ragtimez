---
description: Pull Requestをレビューしてコメントを投稿する。引数にPR番号を指定（例: /review-pr 42）
---

# Pull Request レビュー

指定されたPRをレビューして、GitHubにコメントを投稿する。

## 引数

`$ARGUMENTS` にPR番号を指定（例: `/review-pr 42`）。
番号が省略された場合は、現在のブランチに紐づくPRを自動検出する。

## 手順

1. **PR情報取得** — 以下を並列実行:
   - `gh pr view <番号> --json title,body,author,baseRefName,headRefName,files,additions,deletions`
   - `gh pr diff <番号>` で差分を取得

2. **コードレビュー** — 以下の観点で分析:
   - **セキュリティ**: SQLインジェクション、XSS、認証バイパス、シークレットのハードコード、OWASP Top 10
   - **ロジック**: バグ、エッジケース、エラーハンドリングの欠落
   - **設計**: 過剰な複雑さ、重複コード、不適切な抽象化
   - **RAGtimeZ固有**: Cloudflare WorkersのAPI制約、KVセッション管理、CSRF対策の適切な実装
   - **パフォーマンス**: 不要なAPI呼び出し、キャッシュの欠落

3. **レビュー結果の投稿** — 問題の重大度に応じて:
   - `APPROVE`: 問題なし
   - `REQUEST_CHANGES`: 修正必須の問題あり
   - `COMMENT`: コメントのみ（任意対応）

   ```bash
   gh pr review <番号> --<approve|request-changes|comment> --body "$(cat <<'EOF'
   ## レビュー結果

   ### 重大な問題
   <必須修正事項>

   ### 提案
   <任意の改善提案>

   ### 良い点
   <評価できる実装>
   EOF
   )"
   ```

4. **インラインコメント** — 特定行に対するコメントがある場合:
   ```bash
   gh api repos/{owner}/{repo}/pulls/<番号>/comments \
     --method POST \
     --field body="<コメント>" \
     --field commit_id="<sha>" \
     --field path="<ファイルパス>" \
     --field line=<行番号>
   ```

## 注意事項

- レビューは建設的かつ具体的に記述する
- セキュリティ問題は必ず `REQUEST_CHANGES` で報告する
- `gh` CLIがインストールされていない場合はインストールを案内する
- CLAUDE.mdのアーキテクチャ説明を参照してプロジェクト固有の文脈でレビューする
