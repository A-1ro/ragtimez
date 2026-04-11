import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getContributorRank } from "../../../lib/contributorBadge";

/**
 * Row shape returned from the users table (with computed note_count).
 */
interface UserRow {
  github_id: string;
  username: string;
  avatar_url: string | null;
  github_url: string | null;
  x_url: string | null;
  linkedin_url: string | null;
  bio: string | null;
  created_at: string;
  note_count: number;
}

/**
 * Minimal note shape for the recent_notes list.
 */
interface RecentNote {
  id: string;
  article_slug: string;
  body: string;
  created_at: string;
}

/**
 * GET /api/profile/:username
 *
 * Returns public profile data for a contributor.  No authentication required.
 *
 * Path parameters:
 *   username  – GitHub username (case-insensitive lookup)
 *
 * Response (200):
 *   {
 *     profile: {
 *       github_id, username, avatar_url, github_url, x_url, linkedin_url,
 *       bio, note_count, created_at, rank
 *     },
 *     recent_notes: RecentNote[]   // up to 10 most recent notes
 *   }
 *
 * Error responses:
 *   404  – user not found
 *   500  – DB binding unavailable or database error
 */
export const GET: APIRoute = async ({ params }) => {
  const username = params.username?.trim();

  if (!username) {
    return new Response(
      JSON.stringify({ error: "Username is required" }),
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
    // Case-insensitive lookup; LEFT JOIN to get the total note count.
    const userRow = await env.DB.prepare(
      `SELECT u.github_id, u.username, u.avatar_url, u.github_url, u.x_url,
              u.linkedin_url, u.bio, u.created_at,
              COALESCE(c.cnt, 0) AS note_count
       FROM users u
       LEFT JOIN (
         SELECT author_github_id, COUNT(*) AS cnt
         FROM notes
         GROUP BY author_github_id
       ) c ON c.author_github_id = u.github_id
       WHERE LOWER(u.username) = LOWER(?)`
    )
      .bind(username)
      .first<UserRow>();

    if (!userRow) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch up to 10 most recent notes by this author.
    const notesResult = await env.DB.prepare(
      `SELECT id, article_slug, body, created_at
       FROM notes
       WHERE author_github_id = ?
       ORDER BY created_at DESC
       LIMIT 10`
    )
      .bind(userRow.github_id)
      .all<RecentNote>();

    const recentNotes = notesResult.results ?? [];

    const rank = getContributorRank(userRow.note_count);

    return new Response(
      JSON.stringify({
        profile: {
          github_id:    userRow.github_id,
          username:     userRow.username,
          avatar_url:   userRow.avatar_url,
          github_url:   userRow.github_url,
          x_url:        userRow.x_url,
          linkedin_url: userRow.linkedin_url,
          bio:          userRow.bio,
          note_count:   userRow.note_count,
          created_at:   userRow.created_at,
          rank,
        },
        recent_notes: recentNotes,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[api/profile/username] GET failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
