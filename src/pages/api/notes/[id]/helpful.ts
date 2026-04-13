import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getLangFromRequest, t } from "../../../../lib/i18n";
import { verifyCsrf } from "../../../../lib/csrf";

/**
 * Helper: fetch the current helpful_count for a note after a mutation.
 * Returns 0 if the note no longer exists (edge case after cascaded deletes).
 */
async function getHelpfulCount(noteId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM note_votes WHERE note_id = ?`
  )
    .bind(noteId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/**
 * POST /api/notes/:id/helpful
 *
 * Records a "helpful" vote for the given note on behalf of the authenticated
 * user. Idempotent — a duplicate vote is silently ignored (INSERT OR IGNORE).
 *
 * Path parameter:
 *   id  – note ID (UUID)
 *
 * Response (200):
 *   { helpful_count: number, viewer_has_voted: true }
 *
 * Error responses:
 *   400  – missing note ID
 *   401  – not authenticated
 *   404  – note not found
 *   500  – DB binding unavailable or database error
 */
export const POST: APIRoute = async ({ request, params, locals }) => {
  const lang = getLangFromRequest(request);

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

  // Rate limit: max 60 votes per user per hour
  try {
    const rateLimitRow = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM note_votes WHERE user_github_id = ? AND created_at > datetime('now', '-1 hour')`
    )
      .bind(locals.user.githubId)
      .first<{ cnt: number }>();

    if ((rateLimitRow?.cnt ?? 0) >= 60) {
      return new Response(
        JSON.stringify({ error: t(lang, "noteErrVoteRateLimit") }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "3600",
          },
        }
      );
    }
  } catch (err) {
    console.error("[api/notes/id/helpful] rate limit check failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrInternal") }),
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

    // Verify note exists before inserting the vote.
    const noteRow = await env.DB.prepare(
      `SELECT id FROM notes WHERE id = ?`
    )
      .bind(noteId)
      .first();

    if (!noteRow) {
      return new Response(
        JSON.stringify({ error: t(lang, "noteErrNotFound") }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // INSERT OR IGNORE ensures a user can only vote once per note
    // (PRIMARY KEY (note_id, user_github_id) on note_votes).
    await env.DB.prepare(
      `INSERT OR IGNORE INTO note_votes (note_id, user_github_id) VALUES (?, ?)`
    )
      .bind(noteId, githubId)
      .run();

    const helpfulCount = await getHelpfulCount(noteId);

    return new Response(
      JSON.stringify({ helpful_count: helpfulCount, viewer_has_voted: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[api/notes/id/helpful] POST failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrInternal") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

/**
 * DELETE /api/notes/:id/helpful
 *
 * Removes the authenticated user's "helpful" vote from the given note.
 * Idempotent — deleting a non-existent vote is a no-op.
 *
 * Path parameter:
 *   id  – note ID (UUID)
 *
 * Response (200):
 *   { helpful_count: number, viewer_has_voted: false }
 *
 * Error responses:
 *   400  – missing note ID
 *   401  – not authenticated
 *   500  – DB binding unavailable or database error
 */
export const DELETE: APIRoute = async ({ request, params, locals }) => {
  const lang = getLangFromRequest(request);

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

    await env.DB.prepare(
      `DELETE FROM note_votes WHERE note_id = ? AND user_github_id = ?`
    )
      .bind(noteId, githubId)
      .run();

    const helpfulCount = await getHelpfulCount(noteId);

    return new Response(
      JSON.stringify({ helpful_count: helpfulCount, viewer_has_voted: false }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[api/notes/id/helpful] DELETE failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrInternal") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
