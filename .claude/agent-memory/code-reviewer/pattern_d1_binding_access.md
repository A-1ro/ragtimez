---
name: D1 DB Binding Access Pattern
description: How D1 Database binding is accessed in API routes and pages - confirmed pattern using env from cloudflare:workers
type: project
---

D1 Database (`env.DB`) is accessed via `import { env } from "cloudflare:workers"` — the same pattern used for `env.AUTH_KV` and other bindings. All API routes guard with `if (!env.DB)` and return 500 before using it. The `users` table is populated at OAuth login time via an UPSERT in `src/pages/api/auth/callback.ts`, so the FK reference from `bookmarks.user_github_id → users.github_id` is safe in practice. However, D1/SQLite does not enforce foreign keys by default (no PRAGMA foreign_keys=ON in migrations).

**Why:** Important for future reviews of D1-backed features to understand the established binding access pattern and FK enforcement behavior.

**How to apply:** When reviewing new D1 features, verify: (1) `env.DB` guard before use, (2) parameterized queries, (3) note that FK constraints are declared but not enforced at the DB level.
