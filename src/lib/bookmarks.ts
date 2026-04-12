/**
 * Bookmark utility functions.
 *
 * All functions accept a D1Database instance directly, keeping the
 * dependency on Cloudflare bindings outside this module (callers obtain
 * `env.DB` via `Astro.locals.runtime.env` or `cloudflare:workers`).
 */

export interface Bookmark {
  article_slug: string;
  created_at: string;
}

/**
 * Returns all bookmarks for a user, newest first.
 */
export async function getBookmarks(
  db: D1Database,
  githubId: string
): Promise<Bookmark[]> {
  const result = await db
    .prepare(
      `SELECT article_slug, created_at
       FROM bookmarks
       WHERE user_github_id = ?
       ORDER BY created_at DESC`
    )
    .bind(githubId)
    .all<Bookmark>();

  return result.results ?? [];
}

/**
 * Adds a bookmark. Uses INSERT OR IGNORE so calling this on an already-
 * bookmarked article is a no-op (idempotent).
 */
export async function addBookmark(
  db: D1Database,
  githubId: string,
  slug: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO bookmarks (user_github_id, article_slug, created_at)
       VALUES (?, ?, ?)`
    )
    .bind(githubId, slug, now)
    .run();
}

/**
 * Removes a bookmark. Safe to call even if the bookmark does not exist.
 */
export async function removeBookmark(
  db: D1Database,
  githubId: string,
  slug: string
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM bookmarks WHERE user_github_id = ? AND article_slug = ?`
    )
    .bind(githubId, slug)
    .run();
}

/**
 * Returns true when the user has bookmarked the given article slug.
 */
export async function isBookmarked(
  db: D1Database,
  githubId: string,
  slug: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM bookmarks WHERE user_github_id = ? AND article_slug = ? LIMIT 1`
    )
    .bind(githubId, slug)
    .first();

  return row !== null;
}
