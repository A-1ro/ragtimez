---
name: Security Scan 2026-04-12
description: Comprehensive Phase 1-5 security scan of RAGtimeZ codebase — findings and verified-safe patterns
type: project
---

# Security Scan — 2026-04-12

## Key Findings

### MEDIUM
1. **CSRF on session-auth state-changing endpoints**: POST /api/notes, POST /api/bookmarks, DELETE /api/notes/:id, DELETE /api/bookmarks/:slug, PATCH /api/profile, POST/DELETE /api/notes/:id/helpful — no Origin/Referer check or CSRF token. SameSite=Lax cookie mitigates cross-site POST from forms but not from same-site subdomains or JavaScript-based cross-origin attacks.
2. **Prompt injection via RSS/Tavily content**: External content fed directly into LLM prompts. Mitigation exists (IMPORTANT preamble in system prompt) but no input sanitization or content filtering.
3. **Newsletter subscribe lacks rate limiting**: No rate limit on POST /api/newsletter/subscribe — can be used for email bombing.

### LOW
4. **GitHub Actions uses tag-based action references** (not SHA-pinned).
5. **D1 database ID and KV namespace IDs exposed in wrangler.toml** (low risk, informational).
6. **Logout POST has no CSRF protection** beyond SameSite=Lax.

## Verified Safe Patterns
- All D1 queries use parameterized `.bind()` — no SQL injection vectors found
- Bearer token auth consistently checks `!env.INTERNAL_API_TOKEN` before `timingSafeEqual` (guards empty-string bypass)
- OAuth state is one-time use with 60s TTL; race documented and accepted
- Session IDs validated as UUID v4 before KV lookup
- Cookie flags: HttpOnly, SameSite=Lax, Path=/, Secure on HTTPS
- XSS in notes rendering: `escapeHtml()` applied to all user data before `innerHTML`
- Avatar URL validated against `avatars.githubusercontent.com` hostname
- Profile URLs validated against platform-specific hostname allowlists
- No open redirect: post-login redirect is hardcoded to "/"
- Access token not stored after profile fetch (comment at line 128 of callback.ts)
- Admin auth: dual-path (Bearer + session whitelist) with timing-safe comparison
- Note ownership checks present on DELETE
- Bookmark operations scoped to authenticated user's githubId
- No `eval()`, `Function()`, or dynamic `import()` with user input
- `package-lock.json` exists and is committed
- No secrets in `wrangler.toml` (only namespace IDs and SITE_URL var)
- `.gitignore` covers `.env`, `.env.*`, `.dev.vars`
- Newsletter email masking in error responses
- Newsletter subscribe returns 200 for existing emails (prevents enumeration)
