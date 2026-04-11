---
name: Admin Session Auth Pattern (ADMIN_GITHUB_IDS)
description: PR #52で確立したadmin/qualityの二経路認証パターン（Bearer + GitHub OAuth セッション）と既知のエッジケース
type: project
---

PR #52 で `/admin/quality` に GitHub OAuth セッションによるブラウザアクセスが追加された。

設計パターン:
- `ADMIN_GITHUB_IDS` (optional env) にカンマ区切りの GitHub numeric ID を設定
- `parseAdminIds()` が Set<string> を返し、`adminIds.size > 0` ガードで未設定時を無効化
- `Astro.locals.user.githubId`（文字列）と Set の文字列比較で照合
- Bearer 経路は従来通り `timingSafeEqual` によるタイミングセーフ比較を維持

既知のエッジケース（未修正・仕様として許容）:
- `ADMIN_GITHUB_IDS` 未設定 + ログイン済みユーザーが `/admin/quality` にアクセスすると 401 が返る
  （未設定 + 未ログインは 302 → /api/auth/login → ログイン → 401 という体験になる）
- OAuth コールバックの Location は `/` ハードコード（オープンリダイレクト排除のため）なので
  ログイン後は自力で `/admin/quality` に戻る必要がある

**Why:** Issue #50。ブラウザから admin ダッシュボードを閲覧できるようにするための対応。

**How to apply:** 将来 admin 系ページを追加する場合は同パターンを踏襲すること。
`ADMIN_GITHUB_IDS` 未設定時の挙動（401 vs リダイレクト）は未解決の設計上の疑問点として残っている。
