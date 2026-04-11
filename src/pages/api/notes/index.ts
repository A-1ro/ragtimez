import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

/**
 * Note object returned from the API.
 * `author_note_count` is the total number of notes the author has posted
 * across all articles, used to compute contributor badges on the client.
 */
export interface Note {
  id: string;
  article_slug: string;
  author_github_id: string;
  author_username: string;
  author_avatar: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  /** Total notes posted by this author (for contributor badge rendering). */
  author_note_count: number;
}

/**
 * GET /api/notes?article=<slug>
 *
 * Retrieves all community notes for an article, ordered by creation date
 * (newest first).  Each note includes `author_note_count` — the total number
 * of notes that author has posted across all articles — so the client can
 * render contributor badges without an extra round-trip.
 *
 * Query parameters:
 *   article  – required – article slug
 *
 * Response (200):
 *   { notes: Note[] }
 *
 * Error responses:
 *   400  – missing `article` parameter
 *   500  – DB binding unavailable
 */
export const GET: APIRoute = async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const articleSlug = searchParams.get("article")?.trim();

  if (!articleSlug) {
    return new Response(
      JSON.stringify({ error: "Missing required query parameter: article" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!env.DB) {
    return new Response(
      JSON.stringify({ error: "DB binding is not available in this environment" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // LEFT JOIN a per-author count subquery so that each note row carries the
    // author's total note count.  COALESCE guards against the (impossible in
    // practice) case where the subquery produces no row for an author.
    const result = await env.DB.prepare(
      `SELECT n.id, n.article_slug, n.author_github_id, n.author_username, n.author_avatar,
              n.body, n.created_at, n.updated_at,
              COALESCE(c.cnt, 0) AS author_note_count
       FROM notes n
       LEFT JOIN (
         SELECT author_github_id, COUNT(*) AS cnt
         FROM notes
         GROUP BY author_github_id
       ) c ON c.author_github_id = n.author_github_id
       WHERE n.article_slug = ?
       ORDER BY n.created_at DESC`
    )
      .bind(articleSlug)
      .all();

    const notes = (result.results ?? []) as Note[];

    return new Response(
      JSON.stringify({ notes }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[api/notes] GET failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

/**
 * POST /api/notes
 *
 * Creates a new community note on an article. Requires authentication.
 *
 * Request body:
 *   {
 *     article_slug: string,  // max 200 characters
 *     body: string          // 1-1000 characters
 *   }
 *
 * Response (201):
 *   { note: Note }
 *
 * The returned note includes `author_note_count` reflecting the author's
 * updated total (including this new note) so the client can immediately
 * show the correct contributor badge.
 *
 * Error responses:
 *   400  – invalid request body or validation error
 *   401  – not authenticated (no session cookie)
 *   500  – DB binding unavailable or database error
 */
export const POST: APIRoute = async ({ request, locals }) => {
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

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const payload = body as Record<string, unknown>;
  const articleSlug = String(payload.article_slug ?? "").trim();
  const noteBody = String(payload.body ?? "").trim();

  // Validation
  if (!articleSlug || articleSlug.length === 0) {
    return new Response(
      JSON.stringify({ error: "article_slug is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (articleSlug.length > 200) {
    return new Response(
      JSON.stringify({ error: "article_slug must not exceed 200 characters" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!noteBody || noteBody.length === 0) {
    return new Response(
      JSON.stringify({ error: "body is required and must contain at least 1 character" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (noteBody.length > 1000) {
    return new Response(
      JSON.stringify({ error: "body must not exceed 1000 characters" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // Extract user info from session – locals.user comes from middleware.ts
    const githubId = locals.user.githubId;
    const username = locals.user.login;
    const avatarUrl = locals.user.avatarUrl || null;

    const noteId = crypto.randomUUID();
    const now = new Date().toISOString();

    // The users row is guaranteed to exist at this point: it is upserted by
    // the OAuth callback (src/pages/api/auth/callback.ts) on every login,
    // before any note can be posted.

    // Insert note
    await env.DB.prepare(
      `INSERT INTO notes (id, article_slug, author_github_id, author_username, author_avatar, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(noteId, articleSlug, githubId, username, avatarUrl, noteBody, now, now)
      .run();

    // Fetch the author's updated total note count (includes the note just inserted).
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM notes WHERE author_github_id = ?`
    )
      .bind(githubId)
      .first<{ cnt: number }>();

    const authorNoteCount = countRow?.cnt ?? 1;

    const note: Note = {
      id: noteId,
      article_slug: articleSlug,
      author_github_id: githubId,
      author_username: username,
      author_avatar: avatarUrl,
      body: noteBody,
      created_at: now,
      updated_at: now,
      author_note_count: authorNoteCount,
    };

    return new Response(
      JSON.stringify({ note }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[api/notes] POST failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
