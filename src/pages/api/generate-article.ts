import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { timingSafeEqual } from "../../lib/auth";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of RSS entries passed to the LLM context window.
 * Llama 3.3 70B has a 128k-token context. Each RSS entry is typically
 * ~200–400 tokens, so 20 × 300 ≈ 6 000 tokens for input, leaving the
 * majority of the 4 096-token output budget for the article JSON.
 */
const MAX_CONTEXT_ENTRIES = 20;

/**
 * Number of days of RSS entries to retrieve from D1.
 */
const RSS_LOOKBACK_DAYS = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Domains that are considered "official" sources.
 * The trust level "official" is assigned when at least one chunk comes from
 * these domains.
 */
const OFFICIAL_DOMAINS = [
  "openai.com",
  "anthropic.com",
  "deepmind.google",
  "microsoft.com",
  "azure.microsoft.com",
  "learn.microsoft.com",
  "aws.amazon.com",
  "ai.meta.com",
  "huggingface.co",
  "cloud.google.com",
  "research.google",
];

/**
 * Domains that are always classified as "blog" sources (exact hostname match
 * after stripping leading "www." to avoid substring false-positives).
 */
const BLOG_DOMAINS = [
  "medium.com",
  "dev.to",
  "hashnode.com",
  "substack.com",
  "techcrunch.com",
  "venturebeat.com",
  "zdnet.com",
  "infoq.com",
  "blog.langchain.dev",
];

function classifySourceType(url: string): "official" | "blog" | "other" {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    for (const domain of OFFICIAL_DOMAINS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return "official";
      }
    }
    for (const domain of BLOG_DOMAINS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return "blog";
      }
    }
    // Heuristic: treat subdomains with "blog" as the first label as blog sources.
    if (hostname.split(".")[0] === "blog") {
      return "blog";
    }
    return "other";
  } catch {
    return "other";
  }
}

function deriveTrustLevel(
  sources: { type: "official" | "blog" | "other" }[]
): "official" | "blog" | "speculative" {
  if (sources.length === 0) return "speculative";
  if (sources.some((s) => s.type === "official")) return "official";
  if (sources.some((s) => s.type === "blog")) return "blog";
  // All sources are "other" (unclassified domains) – treat as speculative.
  return "speculative";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArticleSource {
  url: string;
  title?: string;
  type: "official" | "blog" | "other";
}

interface GeneratedArticle {
  filename: string;
  content: string;
  metadata: {
    title: string;
    date: string;
    summary: string;
    trustLevel: "official" | "blog" | "speculative";
    tags: string[];
    sources: ArticleSource[];
    draft: boolean;
  };
}

interface RssEntry {
  source_label: string;
  source_url: string;
  title: string;
  link: string;
  summary: string;
  published_at: string;
}

// ---------------------------------------------------------------------------
// Article generation logic
// ---------------------------------------------------------------------------

const DEFAULT_TOPICS = [
  "latest AI and machine learning developments",
  "large language models news and releases",
  "AI tools and developer ecosystem updates",
];

const LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

/**
 * Build a deduped source list from RSS entries.
 */
function extractSources(entries: RssEntry[]): ArticleSource[] {
  const seen = new Set<string>();
  const sources: ArticleSource[] = [];
  for (const entry of entries) {
    if (seen.has(entry.link)) continue;
    seen.add(entry.link);
    const type = classifySourceType(entry.link);
    sources.push({ url: entry.link, title: entry.title, type });
  }
  return sources;
}

/**
 * Convert RSS entries into a condensed context block for the LLM.
 * Each entry includes the source link, title, and summary.
 */
function buildContext(entries: RssEntry[]): string {
  return entries
    .map(
      (e, i) =>
        `[${i + 1}] Source: ${e.link}\nTitle: ${e.title}\n${e.summary ? e.summary.trim() : "(no summary)"}`
    )
    .join("\n\n---\n\n");
}

/**
 * System prompt that instructs the LLM to produce a structured JSON response
 * followed by the Markdown article body.
 */
const SYSTEM_PROMPT = `You are an expert AI/tech journalist writing for "AI Tech Daily", a daily blog targeting developers working with AI, LLMs, and cloud platforms.

Your task is to produce a well-structured article in Japanese based on the provided research snippets.

Respond with ONLY a JSON object. No markdown fences, no extra text outside the JSON.

Required JSON structure (all values are JSON strings):
{"title":"...","summary":"...","tags":["..."],"body":"..."}

Rules:
- Write entirely in Japanese
- title: concise and informative, under 60 characters
- summary: 1–2 sentences conveying the key insight
- tags: 3–6 short English or Japanese keywords (e.g. "LLM", "OpenAI", "RAG")
- body: 3–4 ## sections with factual content. End with a short developer takeaway paragraph. Use \\n for newlines inside the JSON string.
- Do NOT invent facts not present in the provided sources`;

/**
 * Call the Workers AI LLM to generate an article from the research context.
 */
async function generateWithLLM(
  context: string,
  date: string,
  topics: string[]
): Promise<{ title: string; summary: string; tags: string[]; body: string }> {
  const userMessage = `Today is ${date}. Generate an article covering the following topics: ${topics.join(", ")}.

Use the research snippets below as your sole factual basis:

${context}

Respond with the JSON structure only.`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (env.AI.run as any)(LLM_MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    max_tokens: 2048,
    temperature: 0.4,
    response_format: { type: "json_object" },
  });

  // The model can return a string or an object with a `response` field.
  const raw =
    typeof response === "string"
      ? response
      : (response as { response: string }).response ?? "";

  // Strip any markdown code fences the model may have added.
  const jsonText = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: { title: string; summary: string; tags: string[]; body: string };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // LLMs sometimes emit literal newlines inside JSON string values instead of \n.
    // Escape newlines only within quoted string spans, then retry.
    try {
      const sanitized = jsonText.replace(/"((?:[^"\\]|\\.)*)"/gs, (m) =>
        m.replace(/\r?\n/g, "\\n")
      );
      parsed = JSON.parse(sanitized);
    } catch {
      throw new Error(`LLM returned non-JSON response: ${raw.slice(0, 200)}${raw.length > 200 ? "…(truncated)" : ""}`);
    }
  }

  if (
    typeof parsed.title !== "string" ||
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.tags) ||
    typeof parsed.body !== "string"
  ) {
    throw new Error(
      `LLM JSON missing required fields: ${JSON.stringify(Object.keys(parsed))}`
    );
  }

  return parsed;
}

/**
 * Escape a string value for use inside a YAML double-quoted scalar.
 * Must escape both backslashes (first) and double-quotes to produce valid YAML.
 */
function yamlEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Assemble the full Markdown file content (frontmatter + body).
 */
function buildMarkdown(
  llm: { title: string; summary: string; tags: string[]; body: string },
  date: string,
  sources: ArticleSource[],
  trustLevel: "official" | "blog" | "speculative"
): string {
  const sourcesYaml = sources
    .map((s) => {
      const title = s.title
        ? `\n    title: "${yamlEscape(s.title)}"`
        : "";
      return `  - url: "${yamlEscape(s.url)}"${title}\n    type: "${s.type}"`;
    })
    .join("\n");
  const tagsYaml = llm.tags.map((t) => `  - "${yamlEscape(t)}"`).join("\n");

  return `---
title: "${yamlEscape(llm.title)}"
date: ${date}
summary: "${yamlEscape(llm.summary)}"
sources:
${sourcesYaml}
trustLevel: "${trustLevel}"
tags:
${tagsYaml}
draft: false
---

${llm.body.trim()}
`;
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
 *   date   – ISO date string (default: today in UTC, YYYY-MM-DD)
 *   topics – string[]  search topics (defaults to general AI news)
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
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const dateInput =
    typeof body.date === "string" ? body.date : new Date().toISOString().slice(0, 10);
  // Validate date format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return new Response(
      JSON.stringify({
        error: "date must be in YYYY-MM-DD format",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const topics: string[] =
    Array.isArray(body.topics) && body.topics.length > 0
      ? (body.topics as string[]).map(String)
      : DEFAULT_TOPICS;

  // --- Binding checks -------------------------------------------------------
  if (!env.DB) {
    return new Response(
      JSON.stringify({
        error: "DB binding is not available in this environment",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!env.AI) {
    return new Response(
      JSON.stringify({
        error: "AI binding is not available in this environment",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- D1 (retrieval) -------------------------------------------------------
  let allEntries: RssEntry[] = [];
  try {
    const result = await env.DB.prepare(
      `SELECT source_label, source_url, title, link, summary, published_at
       FROM rss_entries
       WHERE published_at >= datetime('now', ?)
       ORDER BY published_at DESC
       LIMIT ?`
    )
      .bind(`-${RSS_LOOKBACK_DAYS} days`, MAX_CONTEXT_ENTRIES)
      .all();

    if (result.success && result.results) {
      allEntries = result.results as RssEntry[];
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        error: `D1 query failed: ${message}`,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  if (allEntries.length === 0) {
    return new Response(
      JSON.stringify({
        error:
          "No RSS entries found in D1. Run /api/fetch-rss first to populate the database.",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Cap to MAX_CONTEXT_ENTRIES so that sources and LLM context are always
  // in sync: the LLM only reads the entries it can reference.
  const contextEntries = allEntries.slice(0, MAX_CONTEXT_ENTRIES);

  // --- Extract sources & trust level ----------------------------------------
  const sources = extractSources(contextEntries);
  const trustLevel = deriveTrustLevel(sources);

  // --- LLM generation -------------------------------------------------------
  const context = buildContext(contextEntries);
  let llmResult: { title: string; summary: string; tags: string[]; body: string };
  try {
    llmResult = await generateWithLLM(context, dateInput, topics);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        error: `LLM generation failed: ${message}`,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Assemble article -----------------------------------------------------
  const filename = `${dateInput}.md`;
  const content = buildMarkdown(llmResult, dateInput, sources, trustLevel);

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
    },
  };

  return new Response(JSON.stringify(article), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
