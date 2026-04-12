---
name: HTML Escaping Pattern in newsletter.ts
description: escapeHtml symmetry issue resolved in PR #98 — new concern is escapeHtml applied to URL href attributes
type: feedback
---

`escapeHtml()` was asymmetrically applied in `src/lib/newsletter.ts`: applied in `generateArticleEmailHtml` but missing in `generateConfirmationEmailHtml`. This was resolved in PR #98 (Issue #43).

**Remaining policy concern (PR #98):** Applying `escapeHtml` to a URL `href` attribute value converts `&` to `&amp;`, which can corrupt URLs containing `&`-separated query parameters. The current `unsubscribeUrl` is built with a single `encodeURIComponent`-encoded UUID token so no `&` is present — no real breakage today. However, the pattern of escapeHtml-on-URL is architecturally fragile.

**Why:** The correct approach is: use URL encoding for URL components, use HTML escaping only for HTML text nodes and attribute string values that are NOT URLs. The two concerns are orthogonal.

**How to apply:** In future reviews of HTML email template functions, flag any case where `escapeHtml` is applied to a full URL string (as opposed to a plain text value). Flag as Warning, not Critical, if no `&` characters are present in the generated URL.
