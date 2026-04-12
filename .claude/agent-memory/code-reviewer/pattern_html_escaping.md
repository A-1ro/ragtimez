---
name: HTML Escaping Pattern in newsletter.ts
description: Established dual-escaping pattern in newsletter.ts — escapeHtml for text nodes, escapeUrlForHtmlAttr for href attributes
type: feedback
---

**Resolved state (as of PR #121, Issue #99):** `src/lib/newsletter.ts` now has two distinct escaping functions:

- `escapeHtml()` — full 5-char escape (`&`, `<`, `>`, `"`, `'`). Used for text content nodes only (title, summary).
- `escapeUrlForHtmlAttr()` — escapes `"`, `<`, `>` but intentionally NOT `&`. Used for URL `href` attribute values.

This pattern is correct and should be treated as the confirmed standard for this file.

**History:** `escapeHtml()` was asymmetrically applied in PR #98 (Issue #43). The remaining concern — that `escapeHtml` on a URL `href` corrupts `&`-separated query parameters — was resolved in PR #121 (Issue #99).

**Why:** URL encoding and HTML escaping are orthogonal concerns. `&` in a URL is always a query-parameter separator (already percent-encoded by `new URL()` / `encodeURIComponent`), not a literal `&` character requiring `&amp;` escaping.

**How to apply:** In future reviews of HTML email template functions, confirm that text nodes use `escapeHtml()` and URL `href` attributes use `escapeUrlForHtmlAttr()`. Flag any regression where `escapeHtml` is applied to a full URL string.

**Remaining open concern:** `escapeUrlForHtmlAttr` does not escape `'` (single quote). This is safe as long as all templates use double-quoted `href="..."` attributes. Flag as Warning if any template switches to single-quoted attributes.
