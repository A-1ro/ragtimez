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
import {
  sanitizeExternalContent,
  stripOuterMarkdownFence,
} from "../../lib/article-generation/textUtils";
import type {
  ArticleSource,
  GeneratedArticle,
  RssEntry,
} from "../../lib/article-generation/types";
import { AnthropicLlmClient } from "../../lib/llm/AnthropicLlmClient";
import { extractText } from "../../lib/llm/extractText";
import { WorkersAiLlmClient } from "../../lib/llm/WorkersAiLlmClient";
import { TavilySearchProvider } from "../../lib/search/TavilySearchProvider";

// ---------------------------------------------------------------------------
// Security: prompt injection sanitization
// ---------------------------------------------------------------------------
const TOPIC_SELECTION_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

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

/**
 * Parse a raw Markdown article file (with YAML frontmatter) into structured data.
 *
 * This is an intentionally minimal parser that handles the specific frontmatter
 * format emitted by this project's article generator — not a general-purpose YAML
 * parser.  It is used to extract Japanese article content from the request body
 * so that translation mode can be activated without waiting for a Cloudflare Pages
 * deploy (which would be required if we relied solely on getCollection()).
 *
 * Expected frontmatter format:
 *   title: "..."
 *   summary: "..."
 *   tags:
 *     - "tag1"
 *     - "tag2"
 *   trustLevel: "official|blog|speculative"
 *   sources:
 *     - url: "..."
 *       title: "..."
 *       type: "official|blog|other"
 *
 * Returns null if the input cannot be parsed as a valid article.
 */
function parseArticleMarkdown(raw: string): {
  title: string;
  summary: string;
  tags: string[];
  body: string;
  sources: ArticleSource[];
  trustLevel: "official" | "blog" | "speculative";
} | null {
  // Split into frontmatter block and body.
  // The delimiter is "---\n" on line 1 and "---\n" (or "---" at EOF) as close.
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2].trim();

  if (!body) return null;

  // title: "..."
  const titleMatch = frontmatter.match(/^title:\s*"((?:[^"\\]|\\.)*)"\s*$/m);
  if (!titleMatch) return null;
  const title = titleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');

  // summary: "..."
  const summaryMatch = frontmatter.match(/^summary:\s*"((?:[^"\\]|\\.)*)"\s*$/m);
  const summary = summaryMatch
    ? summaryMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    : "";

  // trustLevel: "..."
  const trustMatch = frontmatter.match(/^trustLevel:\s*"([^"]+)"\s*$/m);
  const rawTrust = trustMatch?.[1] ?? "speculative";
  const trustLevel: "official" | "blog" | "speculative" =
    rawTrust === "official" || rawTrust === "blog" ? rawTrust : "speculative";

  // tags:
  //   - "tag1"
  //   - "tag2"
  const tags: string[] = [];
  const tagsBlockMatch = frontmatter.match(/^tags:\n((?:[ \t]+-[ \t]+"[^"]*"\n?)*)/m);
  if (tagsBlockMatch) {
    for (const m of tagsBlockMatch[1].matchAll(/[ \t]+-[ \t]+"([^"]*)"/gm)) {
      tags.push(m[1]);
    }
  }

  // sources:
  //   - url: "..."
  //     title: "..."    (optional)
  //     type: "..."
  //
  // Parse line-by-line instead of using a non-greedy regex block capture.
  // In multiline mode, `$` can match end-of-line, which caused the previous
  // parser to stop after the first `url:` line and drop the remaining sources.
  const sources: ArticleSource[] = [];
  const frontmatterLines = frontmatter.split("\n");
  const unescapeYamlQuoted = (value: string): string =>
    value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");

  let inSources = false;
  let currentSource: ArticleSource | null = null;

  const pushCurrentSource = () => {
    if (!currentSource) return;
    sources.push(currentSource);
    currentSource = null;
  };

  for (const line of frontmatterLines) {
    if (!inSources) {
      if (line === "sources:") inSources = true;
      continue;
    }

    if (/^\S/.test(line)) {
      pushCurrentSource();
      break;
    }

    const urlMatch = line.match(/^[ \t]+-[ \t]+url:\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (urlMatch) {
      pushCurrentSource();
      currentSource = {
        url: unescapeYamlQuoted(urlMatch[1]),
        type: "other",
      };
      continue;
    }

    if (!currentSource) continue;

    const titleMatch = line.match(/^[ \t]+title:\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (titleMatch) {
      currentSource.title = unescapeYamlQuoted(titleMatch[1]);
      continue;
    }

    const typeMatch = line.match(/^[ \t]+type:\s*"([^"]+)"\s*$/);
    if (typeMatch) {
      currentSource.type =
        typeMatch[1] === "official" || typeMatch[1] === "blog"
          ? typeMatch[1]
          : "other";
    }
  }

  pushCurrentSource();

  return { title, summary, tags, body, sources, trustLevel };
}

/**
 * Translate a Japanese article to English using CF Workers AI.
 *
 * Called when lang === "en" and a same-day Japanese article already exists in
 * the Content Collection.  Uses TOPIC_SELECTION_MODEL (a lightweight CF Workers
 * AI model) for both metadata and body translation so that no Claude API call
 * or Tavily search is needed.
 *
 * Two separate LLM calls are made:
 *   1. Metadata (title, summary, tags) — short JSON output, max_tokens 1024
 *   2. Body (Markdown) — long output, max_tokens 4096
 *
 * @param jaArticle  The Japanese article's data + raw Markdown body
 * @param _date      ISO date string (YYYY-MM-DD) — unused but kept for signature symmetry
 */
async function translateArticle(
  jaArticle: {
    title: string;
    summary: string;
    tags: string[];
    body: string;
  },
  _date: string,
): Promise<{
  title: string;
  summary: string;
  tags: string[];
  body: string;
  selectedTopic: string;
  selectedEntries: RssEntry[];
}> {
  // --- Step T1: Metadata translation ---
  const metaSystemPrompt =
    "You are a professional translator. Translate the following Japanese article metadata to English.\n" +
    'Output valid JSON with keys: "title", "summary", "tags" (array of strings).\n' +
    "Keep technical terms (API names, model names, company names) as-is.\n" +
    "The title should be concise (15-50 chars). The summary should be 2-3 sentences.\n" +
    "Output only the JSON, nothing else.";

  const metaUserPrompt = JSON.stringify({
    title: jaArticle.title,
    summary: jaArticle.summary,
    tags: jaArticle.tags,
  });

  const metaResponse = await (env.AI.run as (m: string, o: unknown) => Promise<unknown>)(
    TOPIC_SELECTION_MODEL,
    {
      messages: [
        { role: "system", content: metaSystemPrompt },
        { role: "user", content: metaUserPrompt },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    },
  );

  const metaRaw = extractText(metaResponse)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let translatedMeta: { title: string; summary: string; tags: string[] };
  try {
    const parsed = JSON.parse(metaRaw);
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.tags) ||
      !parsed.tags.every((t: unknown) => typeof t === "string")
    ) {
      throw new Error("Schema validation failed");
    }
    translatedMeta = {
      title: parsed.title.slice(0, 200),
      summary: parsed.summary.slice(0, 500),
      tags: (parsed.tags as string[]).slice(0, 10).map((t) => t.slice(0, 50)),
    };
  } catch {
    // Regex fallback for malformed JSON
    const titleM = /"title"\s*:\s*"([^"]+)"/.exec(metaRaw);
    const summaryM = /"summary"\s*:\s*"([^"]+)"/.exec(metaRaw);
    const tagsM = /"tags"\s*:\s*\[([\s\S]*?)\]/.exec(metaRaw);
    if (!titleM || !summaryM) {
      throw new Error(`Translation metadata parse failed. Raw: ${metaRaw.slice(0, 300)}`);
    }
    translatedMeta = {
      title: titleM[1].trim().slice(0, 200),
      summary: summaryM[1].replace(/,\s*$/, "").trim().slice(0, 500),
      tags: tagsM
        ? (tagsM[1].match(/"([^"]+)"/g) ?? [])
            .map((s) => s.replace(/"/g, "").slice(0, 50))
            .slice(0, 10)
        : [],
    };
  }

  console.log(`Step T1 metadata translated: title="${translatedMeta.title}"`);

  // --- Step T2: Body translation ---
  const bodySystemPrompt =
    "You are a professional translator specializing in technical content.\n" +
    "Translate the following Japanese Markdown article to English.\n" +
    "Preserve all Markdown formatting (headings, lists, code blocks, links, bold, etc.) exactly.\n" +
    "Keep technical terms, API names, model names, URLs, and code snippets as-is.\n" +
    "Maintain the same paragraph structure and section headings.\n" +
    "The last section ## まとめ should be translated as ## Summary.\n" +
    "Output only the translated Markdown, nothing else.";

  const bodyResponse = await (env.AI.run as (m: string, o: unknown) => Promise<unknown>)(
    TOPIC_SELECTION_MODEL,
    {
      messages: [
        { role: "system", content: bodySystemPrompt },
        { role: "user", content: jaArticle.body },
      ],
      max_tokens: 4096,
      temperature: 0.3,
    },
  );

  const translatedBody = stripOuterMarkdownFence(extractText(bodyResponse));
  if (!translatedBody) {
    throw new Error("Translation returned empty body");
  }

  console.log(`Step T2 body translated: ${translatedBody.length} chars`);

  return {
    ...translatedMeta,
    body: translatedBody,
    // selectedTopic and selectedEntries are unused in translation mode;
    // sources and trustLevel are inherited from the Japanese article instead.
    selectedTopic: jaArticle.title,
    selectedEntries: [],
  };
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

  // --- Translation mode check (English articles only) ----------------------
  // If lang==="en" and a same-day Japanese article is available, we skip
  // D1/Tavily/full-LLM and instead translate it using a lightweight CF Workers
  // AI model.  This significantly reduces cost.
  //
  // Two sources are tried in order of preference:
  //   1. jaArticleContent in the request body — avoids the Cloudflare Pages
  //      deploy race condition that occurs in daily-article.yml (the English
  //      generation call happens before the JP article's commit is deployed).
  //   2. Content Collection (getCollection) — for manual runs or any caller
  //      that did not include jaArticleContent in the request.
  //
  // translationSource is non-null when translation mode is active.
  type TranslationSource = {
    title: string;
    summary: string;
    tags: string[];
    body: string;
    sources: ArticleSource[];
    trustLevel: "official" | "blog" | "speculative";
  };
  let translationSource: TranslationSource | null = null;

  if (lang === "en") {
    // --- Priority 1: jaArticleContent from request body ---
    const jaArticleContent =
      typeof body.jaArticleContent === "string" ? body.jaArticleContent.trim() : "";
    if (jaArticleContent) {
      try {
        const parsed = parseArticleMarkdown(jaArticleContent);
        if (parsed) {
          console.log(`Translation mode: using jaArticleContent from request body`);
          translationSource = parsed;
        } else {
          console.warn(
            `Translation mode: failed to parse jaArticleContent from request body, trying Content Collection`,
          );
        }
      } catch (err) {
        console.warn(
          `Translation mode: jaArticleContent parse error, trying Content Collection: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // --- Priority 2: Content Collection (for manual runs or legacy callers) ---
    if (!translationSource) {
      try {
        const articles = await getCollection("articles");
        // Match articles whose id equals dateInput (slug = date) and whose lang
        // is "ja" or unset (the default per content.config.ts schema).
        const jaArticle = articles.find(
          (a) => a.id === dateInput && (a.data.lang === "ja" || a.data.lang === undefined),
        );
        if (jaArticle) {
          console.log(
            `Translation mode: found Japanese article in Content Collection for ${dateInput}, skipping D1/Tavily`,
          );
          translationSource = {
            title: jaArticle.data.title,
            summary: jaArticle.data.summary,
            tags: jaArticle.data.tags,
            // body is the raw Markdown string (without frontmatter) provided by
            // Astro Content Layer's glob loader.
            body: (jaArticle as unknown as { body?: string }).body ?? "",
            sources: jaArticle.data.sources as ArticleSource[],
            trustLevel: jaArticle.data.trustLevel as "official" | "blog" | "speculative",
          };
        } else {
          console.log(
            `Translation mode: no Japanese article found for ${dateInput}, falling back to full generation`,
          );
        }
      } catch (err) {
        console.warn(
          `Translation mode check failed, falling back to full generation: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

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
      // Translation mode: use lightweight CF Workers AI to translate the
      // Japanese article — no Claude API call, no Tavily search needed.
      llmResult = await translateArticle(
        {
          title: translationSource.title,
          summary: translationSource.summary,
          tags: translationSource.tags,
          body: translationSource.body,
        },
        dateInput,
      );
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
