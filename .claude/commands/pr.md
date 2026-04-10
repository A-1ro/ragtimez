---
description: 現在のブランチからPull Requestを作成する。引数でベースブランチを指定可能（デフォルト: main）
---

# Pull Request 作成

現在のブランチの変更をまとめてPull Requestを作成する。

## 手順

1. **事前確認** — 以下を並列実行:
   - `git status --porcelain` で未コミット変更を確認
   - `git branch --show-current` で現在のブランチを確認
   - `git log main...HEAD --oneline` でコミット一覧を確認
   - `git diff main...HEAD` で変更内容全体を確認

2. **未コミット変更がある場合** — `/commit` スキルの実行を促す（PRには含まれないため）

3. **PR情報の生成** — コミット履歴と差分から以下を生成:
   - タイトル（70文字以内、日本語可）
   - サマリー（変更の目的と影響を箇条書き）
   - テスト計画（手動確認すべき項目）

4. **リモートへプッシュ** — `git push -u origin <branch>` を実行

5. **PR作成** — `gh pr create` で作成:
   ```bash
   gh pr create --title "<タイトル>" --body "$(cat <<'EOF'
   ## 概要
   <変更内容の箇条書き>

   ## テスト計画
   - [ ] <確認項目1>
   - [ ] <確認項目2>

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

6. **PR URLを表示** — 作成されたPRのURLをユーザーに伝える

## 引数

- 引数なし: `main` ブランチへのPRを作成
- `$ARGUMENTS` にベースブランチを指定可能（例: `/pr develop`）

## 注意事項

- main/masterブランチから直接PRは作成しない
- force pushは絶対に行わない
- `gh` CLIがインストールされていない場合はインストールを案内する
