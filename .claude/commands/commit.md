---
description: ステージ済み変更を確認してコミットメッセージを自動生成し、git commitを実行する
---

# Git Commit

変更内容を分析してコミットメッセージを自動生成し、コミットを実行する。

## 手順

1. **状態確認** — 以下を並列実行:
   - `git status` でステージ済み・未ステージ変更を確認
   - `git diff --staged` でステージ済み差分を確認
   - `git log --oneline -5` で直近のコミット形式を確認

2. **コミットメッセージ生成** — 差分を分析して以下の形式でドラフト:
   - プレフィックス: `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `style`
   - 形式: `<type>: <簡潔な説明>（日本語可）`
   - 必要に応じて本文に詳細を追加
   - `.env`・シークレット等の機密ファイルが含まれる場合は警告して停止

3. **コミット実行** — ユーザーに確認後、以下を実行:
   ```bash
   git commit -m "$(cat <<'EOF'
   <生成したコミットメッセージ>

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```

4. **結果確認** — `git status` でコミット成功を確認

## 注意事項

- ステージ済み変更がない場合は `git add` を先に実行するよう案内する
- `--amend` は使わず、常に新規コミットを作成する
- `--no-verify` は絶対に使わない
