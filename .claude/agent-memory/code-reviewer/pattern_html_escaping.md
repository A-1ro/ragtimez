---
name: HTML Escaping Pattern in newsletter.ts
description: escapeHtml is applied in generateArticleEmailHtml but missing in generateConfirmationEmailHtml — asymmetric policy to watch in future reviews
type: feedback
---

`escapeHtml()` in `src/lib/newsletter.ts` is applied to all four interpolated values in `generateArticleEmailHtml`, but the sibling function `generateConfirmationEmailHtml` does not apply it to `unsubscribeUrl`.

The current risk is low because `unsubscribeUrl` is always server-constructed (`new URL(..., env.SITE_URL).href` with a `crypto.randomUUID()` token). However, the policy is asymmetric across the two template functions.

**Why:** Flagged in PR #42 (Issue #13, newsletter feature). The fix commit `7ae775d` corrected `generateArticleEmailHtml` but missed `generateConfirmationEmailHtml`. Reviewer approved the PR since no real attack path exists in current code.

**How to apply:** In future reviews of `src/lib/newsletter.ts`, check that ALL HTML template functions apply `escapeHtml` to every interpolated variable, even server-constructed ones, to enforce consistent policy.
