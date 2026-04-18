import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { env } from "cloudflare:workers";
import { ArticleGenerationOrchestrator } from "../../lib/article-generation/ArticleGenerationOrchestrator";
import { timingSafeEqual } from "../../lib/auth";
import { buildMarkdown } from "../../lib/article-generation/MarkdownAssembler";
import {
  MAX_CONTEXT_ENTRIES,
  PAST_ARTICLES_LOOKBACK_DAYS,
  RSS_LOOKBACK_DAYS,
  TAVILY_MAX_SEARCH_CALLS,
  TAVILY_MAX_EXTRACT_URLS_TOTAL,
} from "../../lib/article-generation/constants";
import { DraftGenerator } from "../../lib/article-generation/DraftGenerator";
import { MetadataGenerator } from "../../lib/article-generation/MetadataGenerator";
import { ResearchEnricher, type TavilyUsageBudget } from "../../lib/article-generation/ResearchEnricher";
import {
  deriveTrustLevel,
  extractSources,
} from "../../lib/article-generation/sourceMetadata";
import { TopicSelector, type RecentArticle } from "../../lib/article-generation/TopicSelector";
import { TranslationService } from "../../lib/article-generation/TranslationService";
import type {
  ArticleSource,
  GeneratedArticle,
  RssEntry,
} from "../../lib/article-generation/types";
import { AnthropicLlmClient } from "../../lib/llm/AnthropicLlmClient";
import { WorkersAiLlmClient } from "../../lib/llm/WorkersAiLlmClient";
import { TavilySearchProvider } from "../../lib/search/TavilySearchProvider";

/**
 * Load recent past articles from the content collection to avoid topic duplication.
 * Returns an array of { title, tags, date } for articles published within the lookback window.
 */
async function loadRecentPastArticles(
  today: string,
): Promise<RecentArticle[]> {
  try {
    const collection = await getCollection("articles", ({ data }) => !data.draft);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - PAST_ARTICLES_LOOKBACK_DAYS);
    return collection
      .map((entry) => ({
        title: entry.data.title,
        tags: entry.data.tags ?? [],
        date:
          entry.data.date instanceof Date
            ? entry.data.date.toISOString().slice(0, 10)
            : String(entry.data.date),
      }))
      .filter((a) => new Date(a.date) >= cutoff)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch (err) {
    console.warn(
      `Failed to load past articles: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/generate-article
 *
 * Generates a Markdown article using D1 RSS entries (for retrieval)
 * and Workers AI / Llama 3.3 70B (for generation).
 *
 * Authentication:
 *   Requires `Authorization: Bearer <INTERNAL_API_TOKEN>` header.
 *
 * Request body (JSON, optional fields):
 *   date             – ISO date string (default: today in UTC, YYYY-MM-DD)
 *   lang             – "ja" | "en" (default: "ja")
 *   jaArticleContent – raw Markdown content (with frontmatter) of the same-day
 *                      Japanese article. When provided and lang==="en", this is
 *                      parsed and used as the translation source, bypassing the
 *                      Content Collection lookup. This avoids the Cloudflare Pages
 *                      deploy race condition in CI where the Japanese article has
 *                      been committed but not yet deployed when the English
 *                      generation request is made.
 *
 * Response 200:
 *   { filename, content, metadata }
 *
 * Error responses:
 *   400 – invalid request body
 *   401 – missing/invalid Authorization
 *   500 – AI or DB binding unavailable
 *   502 – D1 or LLM upstream error
 */
export const POST: APIRoute = async ({ request }) => {
  // --- Auth -----------------------------------------------------------------
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (
    !env.INTERNAL_API_TOKEN ||
    !token ||
    !timingSafeEqual(token, env.INTERNAL_API_TOKEN)
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Parse body -----------------------------------------------------------
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return new Response(
      JSON.stringify({ error: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const dateInput =
    typeof body.date === "string"
      ? body.date
      : new Date().toISOString().slice(0, 10);
  // Validate date format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return new Response(
      JSON.stringify({
        error: "date must be in YYYY-MM-DD format",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const lang: "ja" | "en" = body.lang === "en" ? "en" : "ja";

  // --- Binding checks -------------------------------------------------------
  if (!env.DB) {
    return new Response(
      JSON.stringify({
        error: "DB binding is not available in this environment",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!env.AI) {
    return new Response(
      JSON.stringify({
        error: "AI binding is not available in this environment",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const translationService = new TranslationService(env.AI);
  const translationSource = await translationService.resolveTranslationSource({
    date: dateInput,
    lang,
    jaArticleContent: typeof body.jaArticleContent === "string" ? body.jaArticleContent : undefined,
  });

  // --- D1 (retrieval) — skipped in translation mode -------------------------
  let contextEntries: RssEntry[] = [];
  let fullTextMap: Map<string, string> | undefined;
  const tavilyBudget: TavilyUsageBudget = { searchCalls: 0, extractUrls: 0 };

  if (!translationSource) {
    let allEntries: RssEntry[] = [];
    try {
      const result = await env.DB.prepare(
        `SELECT source_label, source_url, title, link, summary, published_at
         FROM rss_entries
         WHERE published_at >= datetime('now', ?)
           AND rowid IN (
             SELECT rowid FROM rss_entries r2
             WHERE r2.source_label = rss_entries.source_label
               AND r2.published_at >= datetime('now', ?)
             ORDER BY r2.published_at DESC
             LIMIT 2
           )
         ORDER BY published_at DESC`,
      )
        .bind(`-${RSS_LOOKBACK_DAYS} days`, `-${RSS_LOOKBACK_DAYS} days`)
        .all();

      if (result.success && result.results) {
        allEntries = result.results as unknown as RssEntry[];
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({
          error: `D1 query failed: ${message}`,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    if (allEntries.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "No RSS entries found in D1. Run /api/fetch-rss first to populate the database.",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    // Cap to MAX_CONTEXT_ENTRIES so that sources and LLM context are always
    // in sync: the LLM only reads the entries it can reference.
    contextEntries = allEntries.slice(0, MAX_CONTEXT_ENTRIES);

    // --- Tavily RAG（オプション）----------------------------------------------
    // TAVILY_API_KEY が設定されている場合のみ実行。
    // 失敗時は RSS サマリーのみで続行するため、エラーは警告としてログに残す。

    const researchEnricher = new ResearchEnricher(
      env.TAVILY_API_KEY ? new TavilySearchProvider(env.TAVILY_API_KEY) : undefined,
    );
    const initialResearch = await researchEnricher.buildInitialResearch({
      entries: contextEntries,
      date: dateInput,
      tavilyBudget,
    });
    contextEntries = initialResearch.contextEntries;
    fullTextMap = initialResearch.fullTextMap;

    console.log(
      `Tavily 予算消費（ルートハンドラ完了時）: searchCalls=${tavilyBudget.searchCalls}/${TAVILY_MAX_SEARCH_CALLS}, extractUrls=${tavilyBudget.extractUrls}/${TAVILY_MAX_EXTRACT_URLS_TOTAL}`,
    );
  }

  // --- LLM generation -------------------------------------------------------
  let llmResult: {
    title: string;
    summary: string;
    tags: string[];
    body: string;
    selectedTopic: string;
    selectedEntries: RssEntry[];
  };
  try {
    if (translationSource) {
      llmResult = await translationService.translateArticle(translationSource, dateInput);
    } else {
      const pastArticles = await loadRecentPastArticles(dateInput);
      const workersAiClient = new WorkersAiLlmClient(env.AI);
      const orchestrator = new ArticleGenerationOrchestrator(
        new TopicSelector(workersAiClient),
        new ResearchEnricher(
          env.TAVILY_API_KEY ? new TavilySearchProvider(env.TAVILY_API_KEY) : undefined,
        ),
        new MetadataGenerator(workersAiClient),
        new DraftGenerator(
          workersAiClient,
          env.ANTHROPIC_API_KEY ? new AnthropicLlmClient(env.ANTHROPIC_API_KEY) : undefined,
        ),
      );
      llmResult = await orchestrator.generate({
        entries: contextEntries,
        date: dateInput,
        pastArticles,
        lang,
        fullTextMap,
        tavilyBudget,
        db: env.DB,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        error: `LLM generation failed: ${message}`,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- Extract sources & trust level ----------------------------------------
  // In translation mode: inherit sources and trustLevel from the Japanese article.
  // In full generation mode: derive from the LLM-selected RSS entries.
  const sources: ArticleSource[] = translationSource
    ? translationSource.sources
    : extractSources(llmResult.selectedEntries);
  const trustLevel: "official" | "blog" | "speculative" = translationSource
    ? translationSource.trustLevel
    : deriveTrustLevel(sources);

  // --- Assemble article -----------------------------------------------------
  const filename = lang === "en" ? `${dateInput}.en.md` : `${dateInput}.md`;
  const content = buildMarkdown(llmResult, dateInput, sources, trustLevel, lang);

  const article: GeneratedArticle = {
    filename,
    content,
    metadata: {
      title: llmResult.title,
      date: dateInput,
      summary: llmResult.summary,
      trustLevel,
      tags: llmResult.tags,
      sources,
      draft: false,
      lang,
    },
  };

  return new Response(JSON.stringify(article), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
