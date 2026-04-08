import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

/**
 * Constant-time string comparison to prevent timing attacks when checking
 * secret tokens.  Iterates through all bytes of both strings regardless of
 * where the first mismatch occurs.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  // XOR the lengths so that a length difference always produces a non-zero result.
  let result = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return result === 0;
}

/**
 * GET /api/search?q=<query>&limit=<n>
 *
 * Queries the Cloudflare AI Search index (bound as AI_SEARCH in wrangler.toml)
 * and returns matching chunks from the crawled target sites.
 *
 * Authentication:
 *   Requires `Authorization: Bearer <INTERNAL_API_TOKEN>` header.
 *   Set the INTERNAL_API_TOKEN secret in Cloudflare Pages project settings.
 *
 * Query parameters:
 *   q      – required – natural-language search string
 *   limit  – optional – max results to return (default 10, max 50)
 *
 * Response (200):
 *   { search_query: string, chunks: Array<{ id, type, score, text, item }> }
 *
 * Error responses:
 *   400  – missing or empty `q` parameter
 *   401  – missing or invalid Authorization header
 *   500  – AI_SEARCH binding unavailable
 *   502  – AI Search upstream error
 */
export const GET: APIRoute = async ({ request }) => {
  // Authorization: constant-time comparison prevents timing attacks.
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (
    !env.INTERNAL_API_TOKEN ||
    !token ||
    !timingSafeEqual(token, env.INTERNAL_API_TOKEN)
  ) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query) {
    return new Response(
      JSON.stringify({ error: "Missing required query parameter: q" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const rawLimit = parseInt(searchParams.get("limit") ?? "10", 10);
  const maxNumResults = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 50)
    : 10;

  if (!env.AI_SEARCH) {
    return new Response(
      JSON.stringify({
        error: "AI_SEARCH binding is not available in this environment",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let response: Awaited<ReturnType<typeof env.AI_SEARCH.search>>;
  try {
    response = await env.AI_SEARCH.search({
      messages: [{ role: "user", content: query }],
      ai_search_options: {
        retrieval: { max_num_results: maxNumResults },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `AI Search request failed: ${message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      search_query: response.search_query,
      chunks: response.chunks,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
