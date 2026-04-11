---
name: Query Parameter Token Auth Anti-Pattern
description: INTERNAL_API_TOKEN must never be accepted via ?token= query param — header-only is the project standard
type: feedback
---

Do not accept `INTERNAL_API_TOKEN` via `?token=` query parameter in any endpoint or page.

**Why:** Query params appear in Cloudflare access logs, browser history, and referer headers in plaintext. All existing API routes (`search.ts`, `generate-article.ts`) accept only `Authorization: Bearer <token>` headers. Any new admin page or endpoint must follow the same pattern.

**How to apply:** When reviewing or writing auth checks, flag any `searchParams.get("token")` fallback as a security issue requiring removal. Only `Authorization: Bearer` header is acceptable for `INTERNAL_API_TOKEN`.
