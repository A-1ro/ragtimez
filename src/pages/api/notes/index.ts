import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

/**
 * Note object returned from the API
 */
interface Note {
  id: string;
  article_slug: string;
  author_github_id: string;
  author_username: string;
  author_avatar: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/notes?article=<slug>
 *
 * Retrieves all community notes for an article, ordered by creation date (newest first).
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
    const result = await env.DB.prepare(
      `SELECT id, article_slug, author_github_id, author_username, author_avatar, body, created_at, updated_at
       FROM notes
       WHERE article_slug = ?
       ORDER BY created_at DESC`
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
    // The user object has { githubId, login, avatarUrl } from session.ts
    const githubId = locals.user.githubId;
    const username = locals.user.login;
    const avatarUrl = locals.user.avatarUrl || null;

    const noteId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Upsert user record
    await env.DB.prepare(
      `INSERT OR REPLACE INTO users (github_id, username, avatar_url, created_at)
       VALUES (?, ?, ?, COALESCE((SELECT created_at FROM users WHERE github_id = ?), datetime('now')))`
    )
      .bind(githubId, username, avatarUrl, githubId)
      .run();

    // Insert note
    await env.DB.prepare(
      `INSERT INTO notes (id, article_slug, author_github_id, author_username, author_avatar, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(noteId, articleSlug, githubId, username, avatarUrl, noteBody, now, now)
      .run();

    const note: Note = {
      id: noteId,
      article_slug: articleSlug,
      author_github_id: githubId,
      author_username: username,
      author_avatar: avatarUrl,
      body: noteBody,
      created_at: now,
      updated_at: now,
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
