# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev              # Astro dev server (local, no Cloudflare bindings)
npm run pages:dev        # Wrangler Pages dev server (with Cloudflare bindings)

# Build & Preview
npm run build            # Astro production build → ./dist/
npm run preview          # Preview production build locally

# Utility Scripts
npm run setup:ai-search  # Register crawl targets with Cloudflare AI Search
npm run generate:article # Generate an article via LLM (calls the API endpoint)
```

No test suite exists. Manual testing is done via `npm run pages:dev`.

## Architecture

RAGtimeZ is an AI-powered daily tech blog built on **Astro + Cloudflare Pages/Workers**. It uses Astro's server-side rendering (SSR) mode with the Cloudflare adapter — all pages and API routes run as Cloudflare Pages Functions.

```
GitHub Actions (daily cron)
  → POST /api/generate-article (Workers AI + AI Search)
  → Commits Markdown to src/content/articles/
  → Cloudflare Pages rebuilds & deploys static site

User Browser
  → Static Astro pages (article list, article detail)
  → /api/search (AI Search queries, Bearer token auth)
  → /api/auth/* (GitHub OAuth → KV session storage)
```

### Key Cloudflare Bindings (env.d.ts)

| Binding | Type | Purpose |
|---|---|---|
| `AI` | `Ai` | Workers AI for LLM article generation |
| `AI_SEARCH` | `AiSearchInstance` | Cloudflare AI Search index |
| `AUTH_KV` | `KVNamespace` | Session storage (GitHub OAuth) |
| `INTERNAL_API_TOKEN` | `string` | Rate-limits `/api/search`, `/api/generate-article`, and `/api/newsletter/send` |
| `GITHUB_CLIENT_ID/SECRET` | `string` | GitHub OAuth app credentials |
| `SUBSCRIBERS_KV` | `KVNamespace` | Newsletter subscriber storage |
| `RESEND_API_KEY` | `string` | Resend API key for email sending |
| `NEWSLETTER_FROM_EMAIL` | `string` | Sender email address (must be verified in Resend) |
| `SITE_URL` | `string` | Site URL for building unsubscribe/article links |

In wrangler.toml, KV is intentionally unconfigured locally — `AUTH_KV` only works in production or via `wrangler pages dev` with remote bindings.

### Source Layout

- **`src/pages/api/`** — All API routes (Cloudflare Pages Functions)
  - `auth/{login,callback,logout}.ts` — GitHub OAuth flow with CSRF state via KV
  - `search.ts` — AI Search query endpoint (timing-safe Bearer token auth)
  - `generate-article.ts` — Article generation: queries AI Search → calls Workers AI LLM → writes Markdown
  - `newsletter/{subscribe,unsubscribe,send}.ts` — Newsletter subscription and delivery
- **`src/lib/`** — Shared server utilities
  - `auth.ts` — Timing-safe string comparison
  - `session.ts` — KV-backed session CRUD + CSRF state management
  - `newsletter.ts` — Newsletter subscription, Resend email, and HTML template utilities
- **`src/middleware.ts`** — Session loading on every request; attaches `user` to `Astro.locals`
- **`src/content/articles/`** — Auto-generated Markdown files (committed by GitHub Actions bot)
- **`src/constants/crawlTargets.ts`** — 10 sites crawled daily (Azure, OpenAI, Anthropic, etc.)
- **`src/constants/trustLevels.ts`** — Trust badge labels/colors: `official` / `blog` / `speculative`
- **`src/content.config.ts`** — Astro Content Collections schema for articles

### Article Content Schema

```typescript
{
  title: string,
  date: Date,
  summary: string,
  sources: { url: string, title?: string, type: "official"|"blog"|"other" }[],
  trustLevel: "official" | "blog" | "speculative",
  tags: string[],
  draft: boolean
}
```

### GitHub Actions

- **`daily-article.yml`** — Runs at 21:00 UTC (06:00 JST). Calls `POST /api/generate-article`, commits any generated Markdown files as a bot, then sends newsletter email to all subscribers. Requires secrets: `GENERATE_ARTICLE_URL`, `NEWSLETTER_SEND_URL`, `INTERNAL_API_TOKEN`.
- **`check-placeholders.yml`** — Blocks PRs containing `REPLACE_WITH_YOUR_*` strings in config files.

### Development Notes

- `astro.config.mjs` sets `remoteBindings: false` so local Astro dev works without Cloudflare credentials. Use `npm run pages:dev` to test with real bindings.
- TypeScript is configured with `astro/tsconfigs/strict` + `@cloudflare/workers-types`.
- The project targets Japanese Azure/LLM engineers. UI text (trust badges, article metadata) mixes English and Japanese.

## Newsletter Feature Setup

### 1. Resend Account & API Key

1. Sign up at [https://resend.com](https://resend.com)
2. Create a sender email domain and verify it (Resend provides instructions)
3. Generate an API key from the dashboard
4. Set the verified sender email (e.g., `noreply@ragtimez.dev`)

### 2. Create KV Namespace

```bash
wrangler kv namespace create SUBSCRIBERS_KV
wrangler kv namespace create SUBSCRIBERS_KV --preview
```

Copy the returned namespace IDs and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SUBSCRIBERS_KV"
id = "<your-production-id>"
preview_id = "<your-preview-id>"
```

### 3. Set Cloudflare Pages Environment Variables

In the Cloudflare dashboard, set these secrets for the Pages project:

```
RESEND_API_KEY=<your-api-key>
NEWSLETTER_FROM_EMAIL=noreply@ragtimez.dev
SITE_URL=https://ragtimez.dev
```

For local testing with `wrangler pages dev`, create a `.env.local` file:

```env
RESEND_API_KEY=your_key
NEWSLETTER_FROM_EMAIL=your_email
SITE_URL=http://localhost:3000
```

### 4. Update GitHub Actions Secrets

Add a new secret to the repository:

```
NEWSLETTER_SEND_URL=https://ragtimez.dev/api/newsletter/send
```

(Alternatively, derive it from an existing `SITE_URL` or `GENERATE_ARTICLE_URL` secret.)

### 5. Test Locally

```bash
npm run pages:dev
# Visit http://localhost:3000
# Try subscribing via the footer newsletter form
# Check Resend logs for email delivery
```

### 6. Deploy & Monitor

1. Commit `wrangler.toml` changes with real namespace IDs (no placeholders)
2. Push to `main` branch
3. Cloudflare Pages automatically deploys
4. GitHub Actions `daily-article.yml` will now send newsletters on schedule
5. Monitor Resend dashboard for delivery metrics and bounces
