---
name: Bluesky Implementation Details
description: AT Protocol client implementation for RAGtimeZ Bluesky auto-posting feature
type: project
---

## Bluesky Feature Overview

Implemented Bluesky auto-posting (Issue #17) for RAGtimeZ. User explicitly chose Bluesky-only (X/Twitter deferred due to API costs).

## Key Implementation Details

### `src/lib/bluesky.ts` Utilities

- **`createBlueskySession(identifier, appPassword)`** — POST to `https://bsky.social/xrpc/com.atproto.server.createSession`, returns `{ accessJwt, did }`
- **`postToBluesky(options)`** — POST to `https://bsky.social/xrpc/com.atproto.repo.createRecord` with rich text facets and external embed
  - Facets use UTF-8 byte offsets (calculated with `new TextEncoder()`) for URL highlighting
  - External embed includes link title and description as preview metadata
- **`buildBlueskyPostText(title, summary, url, ctaText)`** — Constructs post text within 300-character limit
  - Format: `title\n\n<truncated-summary>\n\n<cta-text>\n<url>`
  - CTA: `"📝 この記事に注釈を追加できます"` (Japanese)
  - Gracefully truncates summary with `…` if needed

### `src/pages/api/social/post-bluesky.ts`

- POST endpoint at `/api/social/post-bluesky`
- Bearer token auth using `INTERNAL_API_TOKEN` + `timingSafeEqual` (from `src/lib/auth.ts`)
- Request body: `{ articleSlug, articleTitle, articleSummary }`
- Returns `{ ok: true, skipped: false, uri }` on success, or `{ ok: true, skipped: true, reason }` if credentials unset
- Gracefully skips (200 OK) if `BLUESKY_IDENTIFIER` or `BLUESKY_APP_PASSWORD` missing — doesn't break article generation flow
- 502 error only on actual Bluesky API failures

### GitHub Actions Integration

- Added "Post to Bluesky" step to `.github/workflows/daily-article.yml` after newsletter step
- `continue-on-error: true` prevents workflow failure if posting fails
- Extracts TITLE/SUMMARY/SLUG from Markdown frontmatter using `sed`
- Payload constructed with `jq` to safely handle special characters
- `BLUESKY_POST_URL` secret gates the feature (undefined = skipped)

### Environment Variables

- `BLUESKY_IDENTIFIER` (optional) — Bluesky handle, e.g., `ragtimez.bsky.social`
- `BLUESKY_APP_PASSWORD` (optional) — App Password from https://bsky.app/settings/app-passwords
- Added to `src/env.d.ts` with optional (`?`) type hints and setup docs

## Why Fetch-Only Implementation

- Cloudflare Workers environment doesn't support npm dependencies well
- AT Protocol is simple REST API — no need for `@atproto/api` client library
- All logic fits cleanly in ~150 lines with explicit error handling
- Makes deployment and debugging transparent

## Why Japanese CTA

Project targets Japanese Azure/LLM engineers; mixed Japanese/English already throughout UI (trust badges, article metadata).

## Testing Notes

- Manual test: `curl -X POST http://localhost:3000/api/social/post-bluesky -H "Authorization: Bearer token" -d '{...}'`
- Unit tests not required per project standards (manual testing via `npm run pages:dev`)
- When `BLUESKY_IDENTIFIER` unset locally, endpoint returns `{ ok: true, skipped: true }`
