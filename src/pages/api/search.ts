import type { APIRoute } from "astro";

/**
 * GET /api/search?q=<query>&limit=<n>
 *
 * Queries the Cloudflare AI Search index (bound as AI_SEARCH in wrangler.toml)
 * and returns matching results from the crawled target sites.
 *
 * Query parameters:
 *   q      – required – natural-language search string
 *   limit  – optional – max results to return (default 10, max 20)
 *
 * Response (200):
 *   { results: Array<{ url, title, snippet, score }> }
 *
 * Error responses:
 *   400  – missing or empty `q` parameter
 *   500  – AI_SEARCH binding unavailable or upstream error
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query) {
    return new Response(
      JSON.stringify({ error: "Missing required query parameter: q" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const rawLimit = parseInt(searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 20)
    : 10;

  const env = locals.runtime?.env;
  if (!env?.AI_SEARCH) {
    return new Response(
      JSON.stringify({
        error: "AI_SEARCH binding is not available in this environment",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let response: Awaited<ReturnType<typeof env.AI_SEARCH.search>>;
  try {
    response = await env.AI_SEARCH.search(query, { limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `AI Search request failed: ${message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ results: response.results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
