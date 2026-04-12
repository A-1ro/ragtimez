import { env } from "cloudflare:workers";

/**
 * Verify that the request Origin header matches the configured SITE_URL.
 *
 * Uses strict equality (not startsWith) to prevent attacks via subdomains
 * or prefixes that begin with the origin string.
 *
 * Returns true if the origin is valid, false otherwise.
 * Returns false when SITE_URL is not configured (e.g., local dev without binding).
 */
export function verifyCsrf(request: Request): boolean {
  const siteUrl = env.SITE_URL;
  if (!siteUrl) return false;
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  return origin === new URL(siteUrl).origin;
}
