import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getLangFromRequest, t } from "../../../lib/i18n";
import { verifyCsrf } from "../../../lib/csrf";

/**
 * Note object returned from the API.
 * `author_note_count` is the total number of notes the author has posted
 * across all articles, used to compute contributor badges on the client.
 * `helpful_count` is the number of "helpful" votes the note has received.
 * `viewer_has_voted` indicates whether the currently authenticated user has voted.
 * `note_type` classifies the note as supplementary information or a correction.
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
  /** Number of "helpful" votes this note has received. */
  helpful_count: number;
  /** Whether the currently authenticated viewer has voted this note as helpful. */
  viewer_has_voted: boolean;
  /** Note classification: supplementary information or a correction. */
  note_type: 'supplement' | 'correction';
}

/**
 * GET /api/notes?article=<slug>[&sort=helpful|new]
 *
 * Retrieves all community notes for an article. Each note includes:
 *   - `author_note_count` — author's total notes (for contributor badge)
 *   - `helpful_count`     — number of helpful votes
 *   - `viewer_has_voted`  — whether the current user voted (false if unauthenticated)
 *
 * Query parameters:
 *   article  – required – article slug
 *   sort     – optional – "helpful" sorts by vote count desc then newest; default/omitted/"new" sorts newest first
 *
 * Response (200):
 *   { notes: Note[] }
 *
 * Error responses:
 *   400  – missing `article` parameter
 *   500  – DB binding unavailable
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const lang = getLangFromRequest(request);
  const { searchParams } = new URL(request.url);
  const articleSlug = searchParams.get("article")?.trim();
  const sort = searchParams.get("sort")?.trim() ?? "new";

  if (!articleSlug) {
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrMissingArticle") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!env.DB) {
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrDbUnavailable") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const viewerGithubId = locals.user?.githubId ?? null;

    // ORDER BY clause: "helpful" sorts by vote count desc then newest first;
    // any other value (including "new") sorts by creation date desc.
    // Note: `helpful_count` here is a column alias defined in the SELECT via the
    // LEFT JOIN subquery on note_votes. SQLite (and D1) allow ORDER BY to reference
    // SELECT-level aliases, so this is valid even though `helpful_count` is not a
    // base-table column.
    const orderByClause =
      sort === "helpful"
        ? "ORDER BY helpful_count DESC, n.created_at DESC"
        : "ORDER BY n.created_at DESC";

    if (viewerGithubId) {
      // Authenticated: join vote counts and per-viewer vote status in one query.
      const result = await env.DB.prepare(
        `SELECT n.id, n.article_slug, n.author_github_id, n.author_username, n.author_avatar,
                n.body, n.created_at, n.updated_at, n.note_type,
                COALESCE(c.cnt, 0) AS author_note_count,
                COALESCE(v.cnt, 0) AS helpful_count,
                CASE WHEN vu.note_id IS NOT NULL THEN 1 ELSE 0 END AS viewer_has_voted
         FROM notes n
         LEFT JOIN (
           SELECT author_github_id, COUNT(*) AS cnt
           FROM notes
           GROUP BY author_github_id
         ) c ON c.author_github_id = n.author_github_id
         LEFT JOIN (
           SELECT note_id, COUNT(*) AS cnt
           FROM note_votes
           GROUP BY note_id
         ) v ON v.note_id = n.id
         LEFT JOIN note_votes vu ON vu.note_id = n.id AND vu.user_github_id = ?
         WHERE n.article_slug = ?
         ${orderByClause}`
      )
        .bind(viewerGithubId, articleSlug)
        .all();

      const rawNotes = (result.results ?? []) as Array<Record<string, unknown>>;
      // SQLite returns integers; coerce the boolean column to an actual boolean.
      // The defensive `=== true` guard handles any future D1 behaviour change
      // that might return a native boolean instead of 0/1.
      const notes: Note[] = rawNotes.map((row) => ({
        ...(row as unknown as Note),
        viewer_has_voted: row.viewer_has_voted === 1 || row.viewer_has_voted === true,
      }));

      return new Response(
        JSON.stringify({ notes }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } else {
      // Unauthenticated: no viewer vote join needed; hardcode viewer_has_voted = false.
      const result = await env.DB.prepare(
        `SELECT n.id, n.article_slug, n.author_github_id, n.author_username, n.author_avatar,
                n.body, n.created_at, n.updated_at, n.note_type,
                COALESCE(c.cnt, 0) AS author_note_count,
                COALESCE(v.cnt, 0) AS helpful_count
         FROM notes n
         LEFT JOIN (
           SELECT author_github_id, COUNT(*) AS cnt
           FROM notes
           GROUP BY author_github_id
         ) c ON c.author_github_id = n.author_github_id
         LEFT JOIN (
           SELECT note_id, COUNT(*) AS cnt
           FROM note_votes
           GROUP BY note_id
         ) v ON v.note_id = n.id
         WHERE n.article_slug = ?
         ${orderByClause}`
      )
        .bind(articleSlug)
        .all();

      const rawNotes = (result.results ?? []) as Array<Record<string, unknown>>;
      const notes: Note[] = rawNotes.map((row) => ({
        ...(row as unknown as Note),
        viewer_has_voted: false,
      }));

      return new Response(
        JSON.stringify({ notes }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    console.error("[api/notes] GET failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrInternal") }),
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
 * show the correct contributor badge. `helpful_count` and `viewer_has_voted`
 * are initialised to 0/false for the newly created note.
 *
 * Error responses:
 *   400  – invalid request body or validation error
 *   401  – not authenticated (no session cookie)
 *   500  – DB binding unavailable or database error
 */
export const POST: APIRoute = async ({ request, locals }) => {
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

  // Rate limit: max 10 notes per user per hour
  try {
    const rateLimitRow = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM notes WHERE author_github_id = ? AND created_at > datetime('now', '-1 hour')`
    )
      .bind(locals.user.githubId)
      .first<{ cnt: number }>();

    if ((rateLimitRow?.cnt ?? 0) >= 10) {
      return new Response(
        JSON.stringify({ error: t(lang, "noteErrRateLimit") }),
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
    console.error("[api/notes] rate limit check failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrInternal") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrInvalidJson") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const payload = body as Record<string, unknown>;
  const articleSlug = String(payload.article_slug ?? "").trim();
  const noteBody = String(payload.body ?? "").trim();
  const rawNoteType = String(payload.note_type ?? "supplement").trim();

  // Validate note_type — only "supplement" or "correction" are accepted.
  if (rawNoteType !== "supplement" && rawNoteType !== "correction") {
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrInvalidType") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const noteType = rawNoteType as "supplement" | "correction";

  // Validation
  if (!articleSlug || articleSlug.length === 0) {
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrArticleRequired") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (articleSlug.length > 200) {
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrArticleTooLong") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!noteBody || noteBody.length === 0) {
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrBodyRequired") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (noteBody.length > 1000) {
    return new Response(
      JSON.stringify({ error: t(lang, "noteErrBodyTooLong") }),
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
      `INSERT INTO notes (id, article_slug, author_github_id, author_username, author_avatar, body, note_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(noteId, articleSlug, githubId, username, avatarUrl, noteBody, noteType, now, now)
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
      // A freshly created note has no votes yet.
      helpful_count: 0,
      viewer_has_voted: false,
      note_type: noteType,
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
      JSON.stringify({ error: t(lang, "noteErrInternal") }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
