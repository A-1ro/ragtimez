---
name: hreflang x-default cross-lang article pages pattern
description: x-default hreflang tag must use the ja article URL, not localizePath of the current URL — localizePath strips /en prefix but leaves the .en article ID intact
type: project
---

For cross-language article pages, the `x-default` hreflang tag must point to the canonical ja article URL.

Using `localizePath(Astro.url.pathname, "ja")` on an en article URL like `/en/articles/2026-04-10.en` produces `/articles/2026-04-10.en`, which is not a valid route. The ja article lives at `/articles/2026-04-10`.

**Why:** `localizePath` only handles the path prefix (adding/removing `/en`) but is unaware of the article ID naming convention (`.en` suffix). So it cannot correctly map en article URLs to ja article URLs on its own.

**How to apply:** When rendering `x-default` hreflang on article detail pages, use the already-resolved `hreflangCurrentPath` (when lang=ja) or `hreflangOtherPath` (when lang=en) rather than calling `localizePath` with the raw pathname. In other words, `x-default` should always equal the ja-language canonical URL.

**Resolution (PR #62, loop 2):** Implemented via `hreflangJaPath = lang === "ja" ? hreflangCurrentPath : hreflangOtherPath` in `BaseLayout.astro`. Article pages pass `alternateLangHref` (string | null) from the caller; BaseLayout uses it to override `hreflangOtherPath`. When `alternateLangHref === null`, both hreflang tags and LanguageSwitcher are suppressed. Pattern is confirmed correct and APPROVED.
