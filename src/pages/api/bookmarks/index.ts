import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getLangFromRequest, t } from "../../../lib/i18n";
import { getBookmarks, addBookmark } from "../../../lib/bookmarks";

/**
 * GET /api/bookmarks
 *
 * Returns the authenticated user's bookmarks, newest first.
 *
 * Response (200):
 *   { bookmarks: { article_slug: string; created_at: string }[] }
 *
 * Error responses:
 *   401  – not authenticated
 *   500  – DB unavailable or database error
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const lang = getLangFromRequest(request);

  if (!locals.user) {
    return new Response(
      JSON.stringify({ error: t(lang, "bookmarkErrUnauthorized") }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!env.DB) {
    return new Response(
      JSON.stringify({ error: t(lang, "bookmarkErrDbUnavailable") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const bookmarks = await getBookmarks(env.DB, locals.user.githubId);
    return new Response(
      JSON.stringify({ bookmarks }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[api/bookmarks] GET failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: t(lang, "bookmarkErrInternal") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

/**
 * POST /api/bookmarks
 *
 * Adds a bookmark for the authenticated user. Idempotent — bookmarking an
 * already-bookmarked article returns 201 without error.
 *
 * Request body:
 *   { slug: string }
 *
 * Response (201):
 *   { ok: true }
 *
 * Error responses:
 *   400  – missing or invalid slug
 *   401  – not authenticated
 *   500  – DB unavailable or database error
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const lang = getLangFromRequest(request);

  if (!locals.user) {
    return new Response(
      JSON.stringify({ error: t(lang, "bookmarkErrUnauthorized") }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!env.DB) {
    return new Response(
      JSON.stringify({ error: t(lang, "bookmarkErrDbUnavailable") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: t(lang, "bookmarkErrInvalidJson") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const payload = body as Record<string, unknown>;
  const slug = String(payload.slug ?? "").trim();

  if (!slug) {
    return new Response(
      JSON.stringify({ error: t(lang, "bookmarkErrSlugRequired") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (slug.length > 200) {
    return new Response(
      JSON.stringify({ error: t(lang, "bookmarkErrSlugTooLong") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    await addBookmark(env.DB, locals.user.githubId, slug);
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[api/bookmarks] POST failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: t(lang, "bookmarkErrInternal") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
