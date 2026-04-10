import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { timingSafeEqual } from "../../lib/auth";

/**
 * GET /api/search?q=<query>&limit=<n>
 *
 * Searches the D1 rss_entries table using LIKE matching on title and summary.
 *
 * Authentication:
 *   Requires `Authorization: Bearer <INTERNAL_API_TOKEN>` header.
 *
 * Query parameters:
 *   q      – required – search string
 *   limit  – optional – max results to return (default 10, max 50)
 *
 * Response (200):
 *   { search_query: string, results: Array<{ title, link, source_label, summary, published_at }> }
 *
 * Error responses:
 *   400  – missing or empty `q` parameter
 *   401  – missing or invalid Authorization header
 *   500  – DB binding unavailable
 *   502  – D1 query error
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
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 50)
    : 10;

  if (!env.DB) {
    return new Response(
      JSON.stringify({
        error: "DB binding is not available in this environment",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const pattern = `%${query}%`;
  let results: D1Result;
  try {
    results = await env.DB.prepare(
      `SELECT title, link, source_label, summary, published_at
       FROM rss_entries
       WHERE title LIKE ? OR summary LIKE ?
       ORDER BY published_at DESC
       LIMIT ?`
    )
      .bind(pattern, pattern, limit)
      .all();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Search query failed: ${message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      search_query: query,
      results: results.results,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
