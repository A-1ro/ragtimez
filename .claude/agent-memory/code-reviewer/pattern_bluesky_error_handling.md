---
name: Bluesky Error Response Sanitization Pattern
description: API error messages from external services must not be passed through to endpoint responses; sanitize to fixed strings
type: feedback
---

In PR #56, `bluesky.ts` threw errors containing raw Bluesky API response bodies, which were then surfaced directly in the 502 response of `post-bluesky.ts`. This is a consistent anti-pattern to watch for in any external-API wrapper.

**Rule:** When catching errors from external service calls (Bluesky, Resend, etc.), log the full error server-side with `console.error`, but return only a fixed-string message to the caller. Never pass `err.message` from an external API call through to the HTTP response body.

**Why:** External API error responses can contain request echo-backs, internal service details, or in worst-case scenarios authentication context. Even if Bluesky itself is safe, this sets a bad precedent for other integrations.

**How to apply:** In any `src/pages/api/` route that calls an external service in a try/catch, check whether the caught error message is returned verbatim. If it is, replace with a fixed string and add `console.error(err)`.
