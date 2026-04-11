/**
 * Admin authorization utilities.
 *
 * Provides a single source of truth for parsing the ADMIN_GITHUB_IDS
 * environment variable and checking whether a session user is an admin.
 *
 * Used by:
 *   - src/middleware.ts      — sets Astro.locals.isAdmin on every request
 *   - src/pages/admin/quality.astro — guards the admin dashboard page
 */

import type { UserSession } from "./session";

/**
 * Parse the comma-separated ADMIN_GITHUB_IDS binding into a Set<string>.
 *
 * Each entry is trimmed and empty strings are excluded so that accidental
 * trailing commas (e.g. "12345,") do not produce phantom members.
 *
 * Returns an empty Set when the binding is absent or empty — this effectively
 * disables whitelist-based browser session access.
 */
export function parseAdminIds(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * Return true when the given session user is in the admin whitelist.
 *
 * False in all of these cases:
 *   - user is undefined (not logged in)
 *   - adminIdsRaw is undefined or empty (whitelist not configured)
 *   - user's githubId is not in the parsed whitelist
 */
export function isAdminUser(
  user: UserSession | undefined,
  adminIdsRaw: string | undefined
): boolean {
  if (!user) return false;
  const adminIds = parseAdminIds(adminIdsRaw);
  if (adminIds.size === 0) return false;
  return adminIds.has(user.githubId);
}
