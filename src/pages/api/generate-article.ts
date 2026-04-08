import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison to prevent timing attacks when validating
 * secret tokens.  Iterates through all bytes of both strings regardless of
 * where the first mismatch occurs.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let result = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return result === 0;
}

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
  // Remaining: all sources are "blog" or "other" (community / unclassified).
  return "blog";
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

interface SearchChunk {
  id: string;
  type: string;
  score: number;
  text: string;
  item: {
    timestamp?: number;
    key: string;
    metadata?: Record<string, unknown>;
  };
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
 * Build a deduped source list from AI Search chunks.
 * The chunk `item.key` is typically the source URL.
 */
function extractSources(chunks: SearchChunk[]): ArticleSource[] {
  const seen = new Set<string>();
  const sources: ArticleSource[] = [];
  for (const chunk of chunks) {
    const url = chunk.item.key;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const type = classifySourceType(url);
    const title =
      typeof chunk.item.metadata?.["title"] === "string"
        ? chunk.item.metadata["title"]
        : undefined;
    sources.push({ url, title, type });
  }
  return sources;
}

/**
 * Convert chunks into a condensed context block for the LLM.
 * Each entry includes the source URL and the relevant text excerpt.
 */
function buildContext(chunks: SearchChunk[]): string {
  return chunks
    .slice(0, 20) // cap to 20 chunks; Llama 3.3 70B has a 128k-token context
                  // but typical chunk text is ~200–400 tokens each, so 20 × 400
                  // ≈ 8 000 tokens, which leaves ample room for the system
                  // prompt (~500 tokens) and the 2 048-token output budget.
    .map((c, i) => `[${i + 1}] Source: ${c.item.key}\n${c.text.trim()}`)
    .join("\n\n---\n\n");
}

/**
 * System prompt that instructs the LLM to produce a structured JSON response
 * followed by the Markdown article body.
 */
const SYSTEM_PROMPT = `You are an expert AI/tech journalist writing for "AI Tech Daily", a daily blog targeting developers working with AI, LLMs, and cloud platforms.

Your task is to produce a well-structured article in Japanese based on the provided research snippets.

You MUST respond with valid JSON in exactly the following structure and nothing else:
{
  "title": "<Japanese article title>",
  "summary": "<1–2 sentence Japanese summary>",
  "tags": ["tag1", "tag2"],
  "body": "<full Markdown body in Japanese (no frontmatter, start directly with ## headings)>"
}

Guidelines:
- Write entirely in Japanese.
- The title should be concise and informative (under 60 characters).
- The summary must be 1–2 sentences that convey the key insight.
- tags: 3–6 short English or Japanese keywords (e.g. "LLM", "OpenAI", "RAG").
- The body should have 2–4 ## sections with factual content grounded in the sources.
- End the body with a short paragraph about what developers should take away.
- Do NOT invent facts not present in the provided sources.
- Do NOT include any frontmatter, code fences, or explanations outside the JSON.`;

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

  const response = await env.AI.run(LLM_MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    max_tokens: 2048,
    temperature: 0.4,
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
    throw new Error(`LLM returned non-JSON response: ${raw.slice(0, 200)}${raw.length > 200 ? "…(truncated)" : ""}`);
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
  const tagsYaml = llm.tags.map((t) => `  - ${t}`).join("\n");

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
 * Generates a Markdown article using Cloudflare AI Search (for retrieval)
 * and Workers AI / Llama 3.3 70B (for generation).
 *
 * Authentication:
 *   Requires `Authorization: Bearer <INTERNAL_API_TOKEN>` header.
 *
 * Request body (JSON, optional fields):
 *   date        – ISO date string (default: today in UTC, YYYY-MM-DD)
 *   topics      – string[]  search topics (defaults to general AI news)
 *   searchLimit – number    max AI Search results per topic (1–20, default 5)
 *
 * Response 200:
 *   { filename, content, metadata }
 *
 * Error responses:
 *   400 – invalid request body
 *   401 – missing/invalid Authorization
 *   500 – AI or AI_SEARCH binding unavailable
 *   502 – AI Search or LLM upstream error
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

  const rawLimit =
    typeof body.searchLimit === "number" ? body.searchLimit : 5;
  const searchLimit = Math.min(Math.max(Math.round(rawLimit), 1), 20);

  // --- Binding checks -------------------------------------------------------
  if (!env.AI_SEARCH) {
    return new Response(
      JSON.stringify({
        error: "AI_SEARCH binding is not available in this environment",
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

  // --- AI Search (retrieval) ------------------------------------------------
  const allChunks: SearchChunk[] = [];

  for (const topic of topics) {
    let searchResult: Awaited<ReturnType<typeof env.AI_SEARCH.search>>;
    try {
      searchResult = await env.AI_SEARCH.search({
        messages: [{ role: "user", content: topic }],
        ai_search_options: {
          retrieval: { max_num_results: searchLimit },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({
          error: `AI Search request failed for topic "${topic}": ${message}`,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    allChunks.push(...searchResult.chunks);
  }

  if (allChunks.length === 0) {
    return new Response(
      JSON.stringify({
        error:
          "AI Search returned no results. Ensure crawl targets are indexed.",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Deduplicate and sort by score (descending) for best context quality.
  const seenChunkIds = new Set<string>();
  const deduped = allChunks
    .filter((c) => {
      if (seenChunkIds.has(c.id)) return false;
      seenChunkIds.add(c.id);
      return true;
    })
    .sort((a, b) => b.score - a.score);

  // --- Extract sources & trust level ----------------------------------------
  const sources = extractSources(deduped);
  const trustLevel = deriveTrustLevel(sources);

  // --- LLM generation -------------------------------------------------------
  const context = buildContext(deduped);
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
