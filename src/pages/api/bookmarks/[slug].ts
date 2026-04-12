import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getLangFromRequest, t } from "../../../lib/i18n";
import { removeBookmark } from "../../../lib/bookmarks";

/**
 * DELETE /api/bookmarks/:slug
 *
 * Removes a bookmark for the authenticated user. Safe to call even when the
 * bookmark does not exist (operation is idempotent).
 *
 * Path parameter:
 *   slug  – article slug
 *
 * Response (204):
 *   (no content)
 *
 * Error responses:
 *   401  – not authenticated
 *   500  – DB unavailable or database error
 */
export const DELETE: APIRoute = async ({ request, params, locals }) => {
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

  const slug = params.slug?.trim();
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
    await removeBookmark(env.DB, locals.user.githubId, slug);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[api/bookmarks/slug] DELETE failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: t(lang, "bookmarkErrInternal") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
