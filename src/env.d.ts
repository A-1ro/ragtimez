/// <reference types="astro/client" />

/**
 * Cloudflare Workers / Pages runtime bindings.
 *
 * These types mirror the bindings declared in wrangler.toml so that
 * `Astro.locals.runtime.env` is fully type-checked in .astro files and
 * Cloudflare Pages Functions.
 */

interface AiSearchResult {
  /** The crawled page URL */
  url: string;
  /** Snippet of text most relevant to the query */
  snippet: string;
  /** Relevance score (0–1) returned by the AI Search index */
  score: number;
  /** Page title, if available */
  title?: string;
}

interface AiSearchResponse {
  results: AiSearchResult[];
}

interface AiSearch {
  /**
   * Search the crawl index using natural-language or keyword queries.
   * @param query  Natural-language search string
   * @param opts   Optional parameters (e.g. maximum number of results)
   */
  search(
    query: string,
    opts?: { limit?: number }
  ): Promise<AiSearchResponse>;
}

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

interface Env {
  /** Cloudflare Workers AI binding (LLM / embedding inference) */
  AI: Ai;
  /** Cloudflare AI Search binding (crawl-index queries) */
  AI_SEARCH: AiSearch;
}

declare namespace App {
  interface Locals extends Runtime {}
}
