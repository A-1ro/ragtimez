import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

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
export const DELETE: APIRoute = async ({ params, locals }) => {
  // Check authentication
  if (!locals.user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized: authentication required" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!env.DB) {
    return new Response(
      JSON.stringify({ error: "DB binding is not available in this environment" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const noteId = params.id?.trim();
  if (!noteId) {
    return new Response(
      JSON.stringify({ error: "Note ID is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const githubId = locals.user.login;

    // Fetch the note to verify ownership
    const noteResult = await env.DB.prepare(
      `SELECT id, author_github_id FROM notes WHERE id = ?`
    )
      .bind(noteId)
      .first();

    if (!noteResult) {
      return new Response(
        JSON.stringify({ error: "Note not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const note = noteResult as { id: string; author_github_id: string };

    // Check ownership
    if (note.author_github_id !== githubId) {
      return new Response(
        JSON.stringify({ error: "Forbidden: you are not the author of this note" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Delete the note
    await env.DB.prepare(`DELETE FROM notes WHERE id = ?`)
      .bind(noteId)
      .run();

    return new Response(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Database operation failed: ${message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
