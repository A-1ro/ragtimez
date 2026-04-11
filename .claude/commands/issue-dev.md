---
description: Issueを読んでブランチ作成 → 実装 → コミット → PR作成 → レビュー → マージまでの開発サイクルを自動実行する。引数にIssue番号を指定（例: /issue-dev 42）
---

# Issue-Driven Development Loop

指定されたGitHub Issueを起点に、実装からマージまでの開発サイクルを自動オーケストレーションする。

## 重要な原則（必読）

**メインエージェントは「オーケストレーター」であり、自分でコードを書いてはいけない。**

- ✅ 実装は **必ず `code-implementer` エージェント** に委譲する。修正量が1行であっても、レビュー後の小さな修正であっても例外なく `code-implementer` を呼ぶ。
- ✅ レビューは **必ず `code-reviewer` エージェント** に委譲する。
- ✅ メインエージェントが直接 `Edit` / `Write` / `NotebookEdit` を使ってよいのは、各フェーズの定型作業のみ:
  - PR本文、コミットメッセージ、Issueコメントの作成（Bashヒアドキュメント）
  - 軽微な調査のための Read / Grep / Glob / Bash
- ❌ 「修正量が少ないから」「直接やった方が速いから」という理由で `code-implementer` をスキップしてはならない。役割分担が崩れ、ログも追えなくなる。
- ❌ メインエージェントが PR にレビューコメントを投稿する際、自分のレビューを書いてはならない。`code-reviewer` から返却された判定・指摘内容を**そのまま**転記する。

## 引数

`$ARGUMENTS` にIssue番号を指定（例: `/issue-dev 42`）

---

## フェーズ 0: 準備・Issue読み込み

1. **Issue取得** — 以下を実行してIssue全文を読む:
   ```bash
   gh issue view $ARGUMENTS --json number,title,body,labels,assignees,comments
   ```

2. **タスク分解** — Issueの内容から実装タスクを分析:
   - 実装すべき機能・修正の一覧を箇条書きで整理する
   - 既存コード（CLAUDE.mdのアーキテクチャ）との関連を把握する
   - 完了条件（Done criteria）を明確にする

3. **ブランチ名生成** — Issue番号とタイトルから生成:
   - 形式: `issue-<番号>/<type>/<短い説明>` （例: `issue-42/feat/add-search-filter`）
   - type: `feat` / `fix` / `refactor` / `docs` / `chore`

---

## フェーズ 1: ブランチ作成

```bash
git checkout main && git pull origin main
git checkout -b <生成したブランチ名>
```

失敗した場合は原因を報告して停止する。

---

## フェーズ 2: 実装（code-implementer エージェント）

**`code-implementer` エージェントに以下を渡して実装を依頼する:**

```
Issue #<番号>: <タイトル>

## 実装タスク
<フェーズ0で分解したタスク一覧>

## 完了条件
<Issueの Done criteria または推定した完了条件>

## 注意事項
- CLAUDE.mdのアーキテクチャに従うこと
- 既存のコードパターンを踏襲すること
- セキュリティ要件（タイミング安全な比較、CSRF対策等）を遵守すること
- テストがない場合でも、手動確認できるよう実装すること
```

エージェントの実装が完了したら、変更されたファイルを `git status` で確認する。

---

## フェーズ 3: コミット

1. **変更を確認**:
   ```bash
   git diff --staged
   git status
   ```

2. **未ステージのファイルをステージング**:
   ```bash
   git add <実装に関係するファイルのみ（.env等は除外）>
   ```

3. **コミット実行**:
   ```bash
   git commit -m "$(cat <<'EOF'
   <type>: <Issue #番号に対応する変更の説明>

   Closes #<番号>

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```

---

## フェーズ 4: PR作成

1. **リモートへプッシュ**:
   ```bash
   git push -u origin <ブランチ名>
   ```

2. **PR作成**:
   ```bash
   gh pr create \
     --title "<Issue番号に対応するPRタイトル>" \
     --body "$(cat <<'EOF'
   ## 概要

   Closes #<Issue番号>

   <変更内容の箇条書き>

   ## 変更ファイル
   <変更したファイルと理由>

   ## テスト計画
   - [ ] `npm run pages:dev` で動作確認
   - [ ] <Issue固有の確認項目>

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )" \
     --base main
   ```

3. **PR番号を記録する**（後続フェーズで使用）

---

## フェーズ 5: コードレビュー（code-reviewer エージェント）

**`code-reviewer` エージェントに以下を渡してレビューを依頼する:**

```
PR #<PR番号> のコードレビューを実施してください。

## レビュー対象
- Issue #<Issue番号>: <タイトル>
- ブランチ: <ブランチ名>
- 変更ファイル: <変更されたファイル一覧>

## 確認コマンド
gh pr diff <PR番号>

## 評価基準
1. セキュリティ問題（OWASP Top 10、Cloudflare Workers制約）
2. CLAUDE.mdのアーキテクチャ・コーディング規約への適合
3. ロジックの正確性・エッジケース対処
4. Issueの完了条件を満たしているか

## 出力形式
以下のいずれかで判定し、判定理由・指摘事項を構造化して返してください:
- APPROVE: マージ可能（良い点・任意コメントを含めてよい）
- REQUEST_CHANGES: <必須修正項目を番号付きリストで>
- COMMENT: <任意の改善提案のみ（必須修正なし）>
```

エージェントからレビュー結果を受け取ったら、**判定に関わらず必ず** 以下の手順でPRにコメントを投稿する:

```bash
gh pr review <PR番号> \
  --<approve|request-changes|comment> \
  --body "$(cat <<'EOF'
## コードレビュー結果（ループ <N> 回目）

**判定: <APPROVE / REQUEST_CHANGES / COMMENT>**

### 指摘事項
<必須修正項目を番号付きで。なければ「なし」>

### 提案（任意）
<改善提案。なければ省略>

### 良い点
<評価できる実装。なければ省略>

---
🤖 Reviewed by code-reviewer agent via Claude Code
EOF
)"
```

`--approve` / `--request-changes` / `--comment` は判定に応じて切り替える。

---

## フェーズ 6: レビュー結果の判定

### 🔴 REQUEST_CHANGES の場合（フェーズ 2 に戻る）

1. PRコメントへの投稿完了を確認する（フェーズ5で実施済み）
2. **`code-implementer` エージェントに修正を依頼する**（フェーズ2と同様、ただし修正指摘を追加）:
   ```
   前回のレビュー指摘事項を修正してください:
   <フェーズ5のレビュー指摘一覧>
   ```
3. 実装完了後、修正内容をPRにコメントする:
   ```bash
   gh pr comment <PR番号> --body "$(cat <<'EOF'
   ## 修正対応（ループ <N> 回目）

   ### 対応した指摘事項
   <番号付きで、各指摘に対して何をどう修正したかを記載>

   ### 変更ファイル
   <修正したファイルと変更概要>

   ---
   🤖 Fixed by code-implementer agent via Claude Code
   EOF
   )"
   ```
4. フェーズ 3 → 5 を再度実行する（ループ最大 **3回** まで）
5. 3回ループしても APPROVE されない場合は、ユーザーに状況を報告して判断を仰ぐ

### 🟡 COMMENT のみの場合

- PRコメントへの投稿完了を確認する（フェーズ5で `--comment` として実施済み）
- APPROVE として扱い、フェーズ 7 へ進む

### 🟢 APPROVE の場合

- PRコメントへの投稿完了を確認する（フェーズ5で `--approve` として実施済み）
- フェーズ 7 へ進む

---

## フェーズ 7: マージと後処理

1. **マージ実行**:
   ```bash
   gh pr merge <PR番号> --squash --delete-branch
   ```

2. **ローカルを同期**:
   ```bash
   git checkout main && git pull origin main
   ```

3. **残タスクの抽出** — Issueの内容・レビューコメントから「今回の実装では対応しなかった事項」を整理する:
   - スコープ外だった機能
   - レビューで提案されたが COMMENT 扱いにした改善案
   - 実装中に発見した技術的負債

4. **残タスクをIssue化**（残タスクがある場合）:
   ```bash
   gh issue create \
     --title "<残タスクのタイトル>" \
     --body "$(cat <<'EOF'
   ## 背景

   Issue #<元Issue番号> の実装時に発見・スコープ外となったタスク。

   ## 内容
   <具体的な残タスク>

   ## 関連PR
   #<PR番号>
   EOF
   )" \
     --label "enhancement"
   ```

5. **完了報告** — ユーザーに以下を報告してください:
   ```
   ## 開発サイクル完了 ✅

   - Issue: #<番号> <タイトル>
   - PR: #<PR番号>（マージ済み）
   - ループ回数: <N>回

   ## 新規Issue化した残タスク
   <作成したIssue番号とタイトルの一覧、または「なし」>

   ## ご確認ください
   <ユーザーに判断を求める事項があれば記載>
   ```

---

## エラーハンドリング

| 状況 | 対処 |
|------|------|
| Issue が存在しない | エラーを表示して停止 |
| ブランチ作成失敗 | 原因を表示して停止 |
| 実装エージェントがエラー | エラー内容を表示し、ユーザーに続行/中止を確認 |
| PR作成失敗 | `gh` ログを確認して原因を報告 |
| 3ループ後も未承認 | 現状を報告してユーザーに判断を仰ぐ |
| マージコンフリクト | コンフリクトファイルを報告してユーザーに解消を依頼 |
