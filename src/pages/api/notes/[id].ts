import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getLangFromRequest, t } from "../../../lib/i18n";
import { verifyCsrf } from "../../../lib/csrf";

/**
 * DELETE /api/notes/:id
 *
 * Deletes a community note. Requires authentication and ownership.
 *
 * Path parameter:
 *   id  – note ID (UUID)
 *
 * Response (204):
 *   (no content)
 *
 * Error responses:
 *   401  – not authenticated (no session cookie)
 *   403  – forbidden (not the note author)
 *   404  – note not found
 *   500  – DB binding unavailable or database error
 */
export const DELETE: APIRoute = async ({ request, params, locals }) => {
  const lang = getLangFromRequest(request);

  // Check authentication
  if (!locals.user) {
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrUnauthorized") }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!verifyCsrf(request)) {
    return new Response(
      JSON.stringify({ error: "Forbidden: CSRF validation failed" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!env.DB) {
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrDbUnavailable") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const noteId = params.id?.trim();
  if (!noteId) {
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrIdRequired") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const githubId = locals.user.githubId;

    // Fetch the note to verify existence and ownership
    const noteResult = await env.DB.prepare(
      `SELECT id, author_github_id FROM notes WHERE id = ?`
    )
      .bind(noteId)
      .first();

    if (!noteResult) {
      return new Response(
        JSON.stringify({ error: t(lang, "noteErrNotFound") }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const note = noteResult as { id: string; author_github_id: string };

    // Check ownership
    if (note.author_github_id !== githubId) {
      return new Response(
        JSON.stringify({ error: t(lang, "noteErrForbidden") }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Delete the note (atomic: only succeeds if ownership matches)
    const result = await env.DB.prepare(
      `DELETE FROM notes WHERE id = ? AND author_github_id = ?`
    )
      .bind(noteId, githubId)
      .run();

    // Safety check: ensure exactly one row was deleted (should always be true given our SELECT above,
    // but this guards against race conditions where the note was deleted between our SELECT and DELETE)
    if (result.meta.changes === 0) {
      return new Response(
        JSON.stringify({ error: t(lang, "noteErrNotFound") }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[api/notes/id] DELETE failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrInternal") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
