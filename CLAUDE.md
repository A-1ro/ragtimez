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
npm run generate:article # Generate an article via LLM (calls the API endpoint)
```

No test suite exists. Manual testing is done via `npm run pages:dev`.

## Architecture

RAGtimeZ is an AI-powered daily tech blog built on **Astro + Cloudflare Pages/Workers**. It uses Astro's server-side rendering (SSR) mode with the Cloudflare adapter — all pages and API routes run as Cloudflare Pages Functions.

```
GitHub Actions (daily cron)
  → POST /api/fetch-rss (RSS → D1)
  → POST /api/generate-article (D1 + Tavily → Workers AI)
  → Commits Markdown to src/content/articles/
  → Cloudflare Pages rebuilds & deploys static site

User Browser
  → Static Astro pages (article list, article detail)
  → /api/search (D1 rss_entries LIKE search, Bearer token auth)
  → /api/auth/* (GitHub OAuth → KV session storage)
```

### Key Cloudflare Bindings (env.d.ts)

| Binding | Type | Purpose |
|---|---|---|
| `AI` | `Ai` | Workers AI for LLM article generation |
| `DB` | `D1Database` | User profiles, community notes, and RSS entry storage |
| `AUTH_KV` | `KVNamespace` | Session storage (GitHub OAuth) |
| `INTERNAL_API_TOKEN` | `string` | Rate-limits `/api/search`, `/api/generate-article`, `/api/fetch-rss`, and `/api/newsletter/send` |
| `GITHUB_CLIENT_ID/SECRET` | `string` | GitHub OAuth app credentials |
| `SUBSCRIBERS_KV` | `KVNamespace` | Newsletter subscriber storage |
| `RESEND_API_KEY` | `string` | Resend API key for email sending |
| `NEWSLETTER_FROM_EMAIL` | `string` | Sender email address (must be verified in Resend) |
| `SITE_URL` | `string` | Site URL for building unsubscribe/article links |
| `ADMIN_GITHUB_IDS` | `string` (optional) | Comma-separated list of GitHub numeric IDs allowed to access `/admin/quality` via browser session; unset disables session-based access |
| `BLUESKY_IDENTIFIER` | `string` (optional) | Bluesky handle (e.g., `ragtimez.bsky.social`); unset skips Bluesky posting |
| `BLUESKY_APP_PASSWORD` | `string` (optional) | Bluesky App Password (from https://bsky.app/settings/app-passwords); unset skips Bluesky posting |
| `TAVILY_API_KEY` | `string` (optional) | Tavily API key for web search + full-text extraction; unset falls back to RSS summaries only |
| `GROQ_API_KEY` | `string` (optional) | Groq API key for high-quality draft generation (llama-3.3-70b-versatile); unset falls back to CF Workers AI |

In wrangler.toml, KV is intentionally unconfigured locally — `AUTH_KV` only works in production or via `wrangler pages dev` with remote bindings.

### Source Layout

- **`src/pages/api/`** — All API routes (Cloudflare Pages Functions)
  - `auth/{login,callback,logout}.ts` — GitHub OAuth flow with CSRF state via KV
  - `search.ts` — D1 `rss_entries` table LIKE search endpoint (timing-safe Bearer token auth)
  - `generate-article.ts` — Article generation: queries D1 + Tavily → calls Workers AI LLM → writes Markdown
  - `fetch-rss.ts` — RSS feed fetching: crawls targets → stores entries in D1
  - `newsletter/{subscribe,unsubscribe,send}.ts` — Newsletter subscription and delivery
  - `social/post-bluesky.ts` — Bluesky auto-posting endpoint (AT Protocol)
  - `notes/{index,[id],[id]/helpful}.ts` — Community notes CRUD + helpful votes
  - `bookmarks/{index,[slug]}.ts` — Bookmark management
  - `profile/{index,[username]}.ts` — User profile management
- **`src/lib/`** — Shared server utilities
  - `auth.ts` — Timing-safe string comparison
  - `session.ts` — KV-backed session CRUD + CSRF state management
  - `newsletter.ts` — Newsletter subscription, Resend email, and HTML template utilities
  - `bluesky.ts` — Bluesky (AT Protocol) session and post creation utilities
  - `admin.ts` — Admin role check utilities
  - `bookmarks.ts` — Bookmark D1 query helpers
  - `contributorBadge.ts` — Contributor badge rendering logic
  - `i18n.ts` — Internationalization utilities
  - `profileUrls.ts` — User profile URL helpers
  - `quality.ts` — Article quality scoring utilities
  - `tavily.ts` — Tavily API client for web search + full-text extraction
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

- **`daily-article.yml`** — Runs at 21:00 UTC (06:00 JST). First calls `POST /api/fetch-rss` to populate D1 with the latest RSS entries, then calls `POST /api/generate-article`, commits any generated Markdown files as a bot, sends newsletter email to all subscribers, and posts to Bluesky. Requires secrets: `GENERATE_ARTICLE_URL`, `FETCH_RSS_URL`, `NEWSLETTER_SEND_URL`, `BLUESKY_POST_URL` (optional), `INTERNAL_API_TOKEN`.
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

## Bluesky Auto-Posting Setup

### 1. Create Bluesky Account & App Password

1. Sign up at [https://bsky.app](https://bsky.app)
2. Go to **Settings** → **App passwords** (https://bsky.app/settings/app-passwords)
3. Create a new app password with a name like "RAGtimeZ"
4. Save the app password securely (it's displayed only once)

### 2. Set Cloudflare Pages Secrets

In the Cloudflare dashboard, add these secrets for the Pages project:

```
BLUESKY_IDENTIFIER=your_handle.bsky.social
BLUESKY_APP_PASSWORD=<your-app-password>
```

For local testing with `wrangler pages dev`, add to `.env.local`:

```env
BLUESKY_IDENTIFIER=your_handle.bsky.social
BLUESKY_APP_PASSWORD=<your-app-password>
```

### 3. Set GitHub Actions Secret

Add a new secret to the repository:

```
BLUESKY_POST_URL=https://ragtimez.dev/api/social/post-bluesky
```

### 4. Test Locally

```bash
npm run pages:dev
# The daily-article.yml workflow will call the endpoint after generating an article
# Or manually test with:
curl -X POST http://localhost:3000/api/social/post-bluesky \
  -H "Authorization: Bearer your_internal_api_token" \
  -H "Content-Type: application/json" \
  -d '{
    "articleSlug": "2026-04-11-test",
    "articleTitle": "Test Article",
    "articleSummary": "This is a test article."
  }'
```

### 5. Deploy & Monitor

1. Push credentials to Cloudflare Pages (secrets)
2. Add `BLUESKY_POST_URL` to GitHub Actions secrets (or leave unset to skip Bluesky posting)
3. On next scheduled article generation, the workflow will post to Bluesky
4. Check your Bluesky feed to verify posts appear with article links and metadata
