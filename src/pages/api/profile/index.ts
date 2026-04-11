import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getContributorRank } from "../../../lib/contributorBadge";
import { validateProfileUrl } from "../../../lib/profileUrls";

/** Maximum bio length in characters. */
const MAX_BIO_LENGTH = 500;

/**
 * PATCH /api/profile
 *
 * Updates the authenticated user's own profile.  All fields are optional;
 * supplying null or an empty string for a URL field clears it.
 *
 * Request body (JSON):
 *   {
 *     github_url?:   string | null,
 *     x_url?:        string | null,
 *     linkedin_url?: string | null,
 *     bio?:          string | null
 *   }
 *
 * Response (200):
 *   { profile: { github_id, username, avatar_url, github_url, x_url,
 *                linkedin_url, bio, note_count, created_at, rank } }
 *
 * Error responses:
 *   400  – validation error
 *   401  – not authenticated
 *   500  – DB binding unavailable or database error
 */
export const PATCH: APIRoute = async ({ request, locals }) => {
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

  // Validate each URL field.  Fields absent from the payload are left
  // unchanged (we use COALESCE in the UPDATE below).
  const githubUrlRaw   = "github_url"   in payload ? String(payload.github_url   ?? "") : undefined;
  const xUrlRaw        = "x_url"        in payload ? String(payload.x_url        ?? "") : undefined;
  const linkedinUrlRaw = "linkedin_url" in payload ? String(payload.linkedin_url ?? "") : undefined;
  const bioRaw         = "bio"          in payload ? String(payload.bio           ?? "") : undefined;

  // Validate supplied URL fields.
  if (githubUrlRaw !== undefined) {
    const result = validateProfileUrl(githubUrlRaw, "github");
    if (!result.valid) {
      return new Response(
        JSON.stringify({ error: `github_url: ${result.error}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  if (xUrlRaw !== undefined) {
    const result = validateProfileUrl(xUrlRaw, "x");
    if (!result.valid) {
      return new Response(
        JSON.stringify({ error: `x_url: ${result.error}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  if (linkedinUrlRaw !== undefined) {
    const result = validateProfileUrl(linkedinUrlRaw, "linkedin");
    if (!result.valid) {
      return new Response(
        JSON.stringify({ error: `linkedin_url: ${result.error}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Validate bio length.
  if (bioRaw !== undefined && bioRaw.length > MAX_BIO_LENGTH) {
    return new Response(
      JSON.stringify({ error: `bio must not exceed ${MAX_BIO_LENGTH} characters` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const githubId = locals.user.githubId;

    // Resolve final values: validated URL (possibly null) or keep existing.
    const githubUrlResult   = githubUrlRaw   !== undefined ? validateProfileUrl(githubUrlRaw,   "github")   : null;
    const xUrlResult        = xUrlRaw        !== undefined ? validateProfileUrl(xUrlRaw,        "x")        : null;
    const linkedinUrlResult = linkedinUrlRaw !== undefined ? validateProfileUrl(linkedinUrlRaw, "linkedin") : null;

    // Build UPDATE — only modify columns that were present in the request body.
    // Columns not supplied keep their existing value via COALESCE with a
    // subquery.  This avoids overwriting fields the user didn't touch.
    await env.DB.prepare(
      `UPDATE users
       SET
         github_url   = ${githubUrlResult   !== null ? "?" : "(SELECT github_url   FROM users WHERE github_id = ?)"},
         x_url        = ${xUrlResult        !== null ? "?" : "(SELECT x_url        FROM users WHERE github_id = ?)"},
         linkedin_url = ${linkedinUrlResult !== null ? "?" : "(SELECT linkedin_url FROM users WHERE github_id = ?)"},
         bio          = ${bioRaw            !== undefined ? "?" : "(SELECT bio          FROM users WHERE github_id = ?)"}
       WHERE github_id = ?`
    )
      .bind(
        ...(githubUrlResult   !== null ? [githubUrlResult.url]   : [githubId]),
        ...(xUrlResult        !== null ? [xUrlResult.url]        : [githubId]),
        ...(linkedinUrlResult !== null ? [linkedinUrlResult.url] : [githubId]),
        ...(bioRaw            !== undefined ? [bioRaw.trim() || null] : [githubId]),
        githubId
      )
      .run();

    // Fetch the updated profile to return.
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
       WHERE u.github_id = ?`
    )
      .bind(githubId)
      .first<{
        github_id: string;
        username: string;
        avatar_url: string | null;
        github_url: string | null;
        x_url: string | null;
        linkedin_url: string | null;
        bio: string | null;
        created_at: string;
        note_count: number;
      }>();

    if (!userRow) {
      // Should not happen — user exists because they are authenticated.
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

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
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[api/profile] PATCH failed", { error: String(err) });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
