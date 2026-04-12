# RAGtimeZ

> Azure/LLM/RAG/AIエージェント特化の自動生成技術ブログ + コミュニティノート

## 1. Overview

RAGtimeZ is a blog where AI automatically researches the web daily in the fields of Azure, LLM, RAG, and AI Agents, then auto-publishes one article per day. Readers and experts can add annotations, supplements, and corrections to articles through "Community Notes" (similar to X/Twitter's Community Notes).

### Why

- Generic AI newsletters are saturated (TLDR AI: 1.2M-1.75M readers), but no Azure/LLM/RAG-focused media exists as of April 2026
- Solves the AI-generated article trust problem with a human annotation layer -- a hybrid model with no existing implementations
- Serves as the author's career portfolio, proving expertise in Azure x LLM app development

### Target Users

| Segment | Need | Priority |
|---|---|---|
| **Azure/LLM Engineers (Japanese)** | Daily catchup in Japanese | Primary |
| **AI Product Managers** | Bird's-eye view of tech trends | High |
| **AI Learners / Career Changers** | Direction on what to learn | Medium |
| **Recruiters / Technical Evaluators** | Assess the author's skillset | Secondary |

## 2. Differentiation

### Three-Layer Architecture

```
Layer 1: AI auto-research & article generation (daily, zero manual effort)
Layer 2: Community Notes (human annotations, supplements, corrections)
Layer 3: Niche focus (Azure / LLM / RAG / AI Agents only)
```

| Axis | TLDR AI | Hacker News | AI Tech Daily |
|---|---|---|---|
| Scope | All AI | All tech | Azure/LLM/RAG focused |
| Generation | Human curation | User submissions | AI auto-generation |
| Correction | None | Comments | **Structured annotations** |
| Japanese | No | No | **Yes** |
| Ops cost | High (manual) | Medium | **Low (automated)** |

## 3. Cold Start Strategy

The biggest risk: before annotators gather, it's just "an AI-only article site."

### Staged Approach

- **Phase 0 (Pre-launch):** Author becomes the first annotator -- annotate every article for 30 days
- **Phase 1 (Launch ~ 3 months):** Invite 5-10 Azure/LLM engineers. Offer "Contributor" badges with profile links
- **Phase 2 (3 months+):** Open to anyone with GitHub auth. Weekly "Best Notes" roundups

### Fallback for Zero-Note Articles

- **Confidence labels:** "Official source referenced / Blog source only / Includes speculation"
- **Auto-linked official docs:** Microsoft Learn / OpenAI docs linked to claims
- **Day-over-day diff highlights:** Mark progress when the same topic appears consecutively

## 4. MVP Definition

### In Scope

- [ ] AI research pipeline (GitHub Actions + Workers AI)
- [ ] 1 article/day auto-generation & publish
- [ ] Static site (Cloudflare Pages + Astro)
- [ ] Community Notes UI (view & submit annotations)
- [ ] GitHub OAuth authentication
- [ ] RSS feed

### Out of Scope (Phase 2)

- Newsletter (email delivery)
- Annotator ranking / badge system
- Multi-language support (English version)
- Category filters
- "Helpful" voting on annotations
- Public API

### Definition of Done

> "One article is automatically published daily by AI, readers can add annotations via GitHub auth, and those annotations are displayed on the article page."

## 5. Phases

### Phase 1: MVP (4 weeks)

| Week | Milestone | Deliverable |
|---|---|---|
| 1 | Research pipeline | Cloudflare AI Search + Workers AI: crawl target sites, generate summaries |
| 2 | Article template & site | Astro + Cloudflare Pages for display. Auto-generation Markdown template |
| 3 | Community Notes feature | GitHub OAuth, D1 annotation storage, annotation display/submit UI |
| 4 | Integration test & launch | GitHub Actions cron, E2E tests, domain setup, launch |

### Phase 2: Enhancement (1-3 months post-launch)

| Feature | Purpose |
|---|---|
| Newsletter (Resend) | Retention |
| Annotator badges & profiles | Community incentives |
| "Helpful" voting | Annotation quality signal |
| Article quality score | AI quality improvement cycle |
| English version | Reach expansion |
| X/Bluesky auto-posting | Inbound channel expansion |

## 6. Tech Stack

### Architecture

```
[GitHub Actions (cron: 6:00 AM JST daily)]
    |
    v
[Cloudflare Workers AI]
    |-- AI Search: Crawl & RAG search target sites
    |-- LLM (Workers AI): Research results -> Article Markdown
    |
    v
[GitHub Repository] <- Commit article Markdown
    |
    v
[Cloudflare Pages (Astro)] <- Auto-deploy via GitHub integration
    |
    v
[User's Browser]
    |-- Read articles (static HTML)
    |-- Submit/view annotations -> [Cloudflare Workers API] -> [D1]
    |-- GitHub OAuth -> [Cloudflare Workers API]
```

### Technology Choices

| Layer | Choice | Why | Why not alternatives |
|---|---|---|---|
| Research/RAG | Cloudflare AI Search | URL-based crawl + RAG search unified. Native Workers AI integration | Self-built RAG pipeline: too costly to build & maintain |
| Article LLM | Workers AI (Llama 3.3 70B) | Stays in Cloudflare ecosystem. Free tier available | OpenAI API: expensive. Azure OpenAI: personal quota limits |
| Site Framework | Astro | Optimal for static sites. Native Markdown. Cloudflare Pages adapter | Next.js: SSR unnecessary, overkill |
| Hosting | Cloudflare Pages | Generous free tier. Seamless Workers integration | Vercel: equivalent but roundabout Workers AI integration |
| Annotation DB | Cloudflare D1 (SQLite) | Direct binding access from Workers. Free tier 5GB | Neon (PostgreSQL): external connection required, overkill for MVP |
| Auth | GitHub OAuth (Workers) | Target readers are engineers. GitHub auth is natural | Auth.js: unnecessary library complexity |
| CI/CD | GitHub Actions | Unified article generation cron & repo commits | Workers Cron: cumbersome for Git commit workflows |

### Cost Estimate (MVP)

| Item | Monthly | Notes |
|---|---|---|
| Cloudflare Workers AI | $0 | Free tier: 10,000 req/day |
| Cloudflare Pages | $0 | Free tier |
| Cloudflare D1 | $0 | Free tier: 5GB, 5M req/month |
| GitHub Actions | $0 | Free tier: 2,000 min/month |
| Domain | ~$10/year | .dev or .tech |
| **Total** | **~$1/month** | Domain cost only |

## 7. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Cold start problem | High | High | Staged approach (Section 3). Fallback labels make zero-note articles still valuable |
| AI hallucination | High | Medium | Confidence labels. Required source links. Community Notes as correction layer |
| Cloudflare AI Search limits | Medium | Medium | Cap at 10 target sites for Phase 1. Switch to custom crawler if insufficient |
| Workers AI LLM quality | Medium | Low | Prompt tuning. Fallback to external API (Claude/GPT) if needed |
| Annotation spam | Low | Low | GitHub auth as barrier. Phase 2 moderation |
| Copyright (crawl source ToS) | Medium | Low | Official blogs/docs only. Summary + source link format stays within fair use |
| Operator burnout | Medium | Medium | Weekly quality review. Monthly annotation trend check. No full autopilot |

## 8. KPIs

### Phase 1 (MVP: first 4 weeks)

| KPI | Target | Measurement |
|---|---|---|
| Article auto-publish success rate | 95%+ (28/30 days) | GitHub Actions success rate |
| Annotations per article | 0.5/article (self included) | D1 query |
| Site visitors | 100 UU/week | Cloudflare Analytics |

### Phase 2 (3 months)

| KPI | Target | Measurement |
|---|---|---|
| Monthly UU | 1,000 UU/month | Cloudflare Analytics |
| Annotators (excluding self) | 5+ | D1 query |
| Annotations per article | 1.0/article | D1 query |
| RSS subscribers | 50 | Feed access logs |
| Newsletter subscribers | 100 | Resend dashboard |

### North Star Metric

> **"Percentage of articles with human annotations"**
>
> As this number rises, it proves the AI article + human annotation hybrid model works. Target: 50% by end of Phase 2.

---

## 9. Development Setup

### Cloudflare AI Search

Cloudflare AI Search crawls the target sites and exposes a RAG-ready search index that Workers can query through the `AI_SEARCH` binding (see `wrangler.toml`).

#### Step 1 – Create the AI Search index

1. Open the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **AI** → **AI Search**.
2. Click **Create index** and name it `ai-tech-daily-search`.
3. Note your **Account ID** from the dashboard sidebar.

#### Step 2 – Register crawl targets

Crawl targets are defined in [`src/constants/crawlTargets.ts`](src/constants/crawlTargets.ts).  
Run the setup script once to register all 10 sites with the AI Search index:

```bash
export CLOUDFLARE_ACCOUNT_ID="<your-account-id>"
export CLOUDFLARE_API_TOKEN="<token-with-AI-Search-write-permission>"

npm run setup:ai-search
```

The script calls `POST /accounts/{id}/ai-search/indexes/ai-tech-daily-search/sources` for each target and prints a success/failure summary.  
You can verify registrations in the Dashboard under **AI > AI Search > Sources**.

#### Step 3 – Bind AI Search to the Pages project

In the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → your Pages project → **Settings** → **Bindings**, add:

| Type | Variable name | Index |
|------|--------------|-------|
| AI Search | `AI_SEARCH` | `ai-tech-daily-search` |
| Workers AI | `AI` | *(auto)* |

These bindings are already declared in `wrangler.toml` for local development (`wrangler pages dev`).

#### Step 4 – Set the internal API token secret

`/api/search` requires a `Authorization: Bearer <token>` header to prevent public misuse (Cloudflare AI Search calls are metered).

```bash
# Set the secret in your Pages project (replace with a strong random value)
wrangler pages secret put INTERNAL_API_TOKEN
```

#### Step 5 – Verify with the search API

Once the index has crawled at least one source, test it:

```bash
# Local dev (wrangler pages dev — default port is 8788, but may vary)
curl -H "Authorization: Bearer <your-token>" \
  "http://localhost:8788/api/search?q=Azure+OpenAI+latest&limit=5"

# Production
curl -H "Authorization: Bearer <your-token>" \
  "https://<your-pages-domain>/api/search?q=Azure+OpenAI+latest&limit=5"
```

Expected response shape:

```json
{
  "search_query": "Azure OpenAI latest",
  "chunks": [
    {
      "id": "...",
      "type": "text",
      "score": 0.92,
      "text": "...",
      "item": { "key": "https://azure.microsoft.com/en-us/blog/..." }
    }
  ]
}
```

### GitHub OAuth & AUTH_KV Setup

GitHub OAuth enables user login. Session tokens are stored in a Cloudflare KV namespace (`AUTH_KV`). The `wrangler.toml` in this repository already contains the project's own namespace IDs. If you are deploying your own instance, you will need to replace those IDs with the ones created for your account (see Step 2 below). In production, the KV binding must also be configured via the Cloudflare Dashboard in addition to `wrangler.toml`.

#### Step 1 – Create a GitHub OAuth App

1. Go to **GitHub** → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. Fill in the fields:

   | Field | Value |
   |---|---|
   | Application name | `RAGtimeZ` (or any name) |
   | Homepage URL | `https://<your-pages-domain>` |
   | Authorization callback URL | `https://<your-pages-domain>/api/auth/callback` |

3. Click **Register application**.
4. On the next screen, note your **Client ID** and generate a **Client Secret**.

For local development with `wrangler pages dev`, also add `http://localhost:8788/api/auth/callback` as an authorized callback URL. GitHub OAuth Apps support multiple callback URLs on the same app, so you do not need a separate app for local use.

#### Step 2 – Create the AUTH_KV namespace

> **Note:** If you cloned this repository, `wrangler.toml` already contains the original project's namespace IDs. Replace them with your own before proceeding.

```bash
# Create the KV namespace (production)
wrangler kv namespace create AUTH_KV

# Create the KV namespace (preview / local wrangler pages dev)
wrangler kv namespace create AUTH_KV --preview
```

Replace the existing `AUTH_KV` entry in `wrangler.toml` with the IDs returned by the commands above:

```toml
[[kv_namespaces]]
binding = "AUTH_KV"
id = "<your-production-namespace-id>"
preview_id = "<your-preview-namespace-id>"
```

> **Production note:** In production, the KV binding must also be configured in the Cloudflare Dashboard under **Workers & Pages** → your Pages project → **Settings** → **Bindings**. Add a KV namespace binding with variable name `AUTH_KV` pointing to the namespace you created above. The `wrangler.toml` entry is used only for local `wrangler pages dev` and does not affect the production deployment.

#### Step 3 – Set the OAuth secrets

```bash
wrangler pages secret put GITHUB_CLIENT_ID
wrangler pages secret put GITHUB_CLIENT_SECRET
```

Enter the Client ID and Client Secret from Step 1 when prompted. These secrets are automatically available to the Pages project at runtime via `context.locals.runtime.env`.

#### Step 4 – (Optional) Grant admin access

The `/admin/quality` page is restricted to a specific list of GitHub user IDs. Set the `ADMIN_GITHUB_IDS` secret to a comma-separated list of numeric GitHub IDs (e.g., `"12345,67890"`) to allow those accounts to access it via their session. If the secret is unset, session-based admin access is disabled entirely.

```bash
wrangler pages secret put ADMIN_GITHUB_IDS
```

### Local development

```bash
npm install
npm run dev          # Astro dev server (no Workers bindings)
npm run pages:dev    # Wrangler Pages dev (includes Workers bindings)
```

---

## Author

**Eiichiro Iriguchi** -- Freelance backend engineer specializing in Azure infrastructure and LLM application development.

- [GitHub](https://github.com/A-1ro)

## License

TBD
