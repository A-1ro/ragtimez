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
| `INTERNAL_API_TOKEN` | `string` | Rate-limits `/api/search` and `/api/generate-article` |
| `GITHUB_CLIENT_ID/SECRET` | `string` | GitHub OAuth app credentials |

In wrangler.toml, KV is intentionally unconfigured locally — `AUTH_KV` only works in production or via `wrangler pages dev` with remote bindings.

### Source Layout

- **`src/pages/api/`** — All API routes (Cloudflare Pages Functions)
  - `auth/{login,callback,logout}.ts` — GitHub OAuth flow with CSRF state via KV
  - `search.ts` — AI Search query endpoint (timing-safe Bearer token auth)
  - `generate-article.ts` — Article generation: queries AI Search → calls Workers AI LLM → writes Markdown
- **`src/lib/`** — Shared server utilities
  - `auth.ts` — Timing-safe string comparison
  - `session.ts` — KV-backed session CRUD + CSRF state management
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

- **`daily-article.yml`** — Runs at 21:00 UTC (06:00 JST). Calls `POST /api/generate-article`, commits any generated Markdown files as a bot. Requires secrets: `GENERATE_ARTICLE_URL`, `INTERNAL_API_TOKEN`.
- **`check-placeholders.yml`** — Blocks PRs containing `REPLACE_WITH_YOUR_*` strings in config files.

### Development Notes

- `astro.config.mjs` sets `remoteBindings: false` so local Astro dev works without Cloudflare credentials. Use `npm run pages:dev` to test with real bindings.
- TypeScript is configured with `astro/tsconfigs/strict` + `@cloudflare/workers-types`.
- The project targets Japanese Azure/LLM engineers. UI text (trust badges, article metadata) mixes English and Japanese.
