---
name: RSS Feed Implementation (Issue #10, #66)
description: PR #34 introduced RSS; PR #116 (issue-66) replaced article.rendered?.html with marked.parse(article.body) to fix content:encoded being absent in production
type: project
---

RSS feed implemented in PR #34. Content field bug (Issue #66) fixed in PR #116 (2026-04-12).

**Root cause of Issue #66:** `article.rendered?.html` was undefined in production. Astro's glob loader calls `render()` at build/load time and stores `rendered` in the data store, but under the Cloudflare Pages SSR adapter this pre-rendered HTML was not reliably available at request time via `getCollection()` without explicitly calling `render(article)` per entry.

**Fix (PR #116):** Replace `article.rendered?.html` with `marked.parse(article.body, { async: false }) as string` — a fresh synchronous Markdown→HTML conversion using `marked` v18.

Key confirmed facts:
- `@astrojs/rss` v4.0.18 used; `content:encoded` is populated when `typeof result.content === "string"`
- `@astrojs/rss` XML-escapes the content string (fast-xml-parser XMLBuilder) — HTML entities are escaped in output, which is RSS 2.0 compliant; RSS readers decode it correctly
- `marked.parse(str, { async: false })` returns `string` (not Promise) when no async extensions are registered
- `article.body` is typed as `string | undefined` in Astro Content Collections; the `article.body ? ... : undefined` guard is correct
- `marked` v18 does NOT sanitize HTML by default — raw HTML blocks in Markdown pass through. For AI-generated articles this is acceptable since content is LLM-controlled, not user-supplied
- `context.site` fallback to `new URL(context.url.origin)` still correct
- `SITE_URL` env var populates `astro.config.mjs` `site` field in production

**How to apply:** In future RSS reviews, do not assume `article.rendered` is populated — always verify whether `render(article)` is called before accessing `.rendered`. The `marked.parse(article.body)` pattern is now the established approach for RSS content generation.
