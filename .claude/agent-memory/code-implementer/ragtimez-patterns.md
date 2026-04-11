---
name: RAGtimeZ Project Patterns & Architecture
description: Key architectural patterns, utilities, and conventions discovered in RAGtimeZ codebase
type: reference
---

## Cloudflare Bindings Access Pattern

All Cloudflare bindings are accessed via:
```typescript
import { env } from "cloudflare:workers";
// Access: env.BINDING_NAME
```

Available bindings documented in `src/env.d.ts` with comments explaining setup.

## API Route Pattern (Astro + Cloudflare Pages Functions)

Located in `src/pages/api/` — each file becomes a serverless function.

```typescript
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const GET: APIRoute = async ({ request }) => {
  if (!env.REQUIRED_BINDING) {
    return new Response(
      JSON.stringify({ error: "Binding unavailable" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Always return Response objects with proper Content-Type headers
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};
```

## Security Patterns

### Timing-Safe Token Comparison
Located in `src/lib/auth.ts`:
```typescript
import { timingSafeEqual } from "../../lib/auth";

if (!timingSafeEqual(userToken, env.SECRET_TOKEN)) {
  return new Response("Unauthorized", { status: 401 });
}
```

### Email Hashing for Duplicate Detection
For operations that must resist timing attacks (like checking if email exists):
```typescript
const emailHash = await sha256Hash(normalizedEmail);
const key = `sub:${emailHash}`;
const existing = await kv.get(key);
```

### CSRF Protection
Check Origin header matches expected domain:
```typescript
const origin = request.headers.get("Origin");
const siteUrl = new URL(env.SITE_URL);
if (origin && !origin.startsWith(siteUrl.origin)) {
  return new Response("CSRF validation failed", { status: 403 });
}
```

## KV Namespace Patterns

### Session Storage
```typescript
// Store: kv.put(`session:${sessionId}`, JSON.stringify(userData), { expirationTtl })
// Fetch: await kv.get(`session:${sessionId}`)
// Delete: await kv.delete(`session:${sessionId}`)
```

### Pagination for Large Lists
```typescript
const items = [];
let cursor;
do {
  const result = await kv.list({ prefix: "item:", cursor });
  for (const key of result.keys) {
    items.push(await kv.get(key.name));
  }
  cursor = result.list_complete ? undefined : result.cursor;
} while (cursor);
```

## Component & Layout Integration

Newsletter form component created at `src/pages/newsletter/form.astro` and imported into layout:
```typescript
import NewsletterForm from "../pages/newsletter/form.astro";
// Use in JSX: <NewsletterForm />
```

Layouts are in `src/layouts/` and use Astro's `<slot />` for page content.

## GitHub Actions Workflow Patterns

### Extracting Metadata
Extract frontmatter from Markdown using sed/awk:
```bash
TITLE=$(sed -n 's/^title: //p' "$FILE" | head -1)
SUMMARY=$(sed -n 's/^summary: //p' "$FILE" | head -1)
```

### Conditional Steps
Use output variables to conditionally run later steps:
```yaml
- name: Some step
  id: mystep
  run: echo "value=data" >> $GITHUB_OUTPUT

- name: Later step
  if: steps.mystep.outcome == 'success'
  run: echo "Previous succeeded"
```

### Graceful Degradation
Don't let external API failures block the workflow:
```yaml
- name: External API call
  continue-on-error: true
  run: curl -f https://api.example.com || echo "API call failed"
```

## Email Template Patterns

All HTML email templates:
- Use inline CSS (Resend requirement)
- Include both plaintext fallbacks in comments
- Japanese localization (site targets JP engineers)
- Always include one-click unsubscribe link
- Use `<a>` tags for actionable elements

## Testing & Validation

- Run `npm run build` to verify TypeScript and Astro build succeeds
- Check placeholders with: `grep -rn "REPLACE_WITH_YOUR" --include="*.toml"`
- Local dev: `npm run pages:dev` (loads Cloudflare bindings)
- Regular dev (no bindings): `npm run dev`

## Project Context

- **Framework**: Astro SSR with Cloudflare Pages adapter
- **TypeScript**: `astro/tsconfigs/strict` + `@cloudflare/workers-types`
- **Target Audience**: Japanese Azure/LLM engineers (UI text mixes EN/JP)
- **CI/CD**: GitHub Actions for daily article generation + custom workflows
- **Email**: Resend API for transactional emails
- **Session**: KV-backed sessions with httpOnly cookies
- **Auth**: GitHub OAuth with CSRF state validation
