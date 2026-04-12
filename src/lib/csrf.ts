import { env } from "cloudflare:workers";

/**
 * Verify that the request Origin (or Referer as fallback) matches SITE_URL.
 *
 * Uses strict equality on the origin portion. Falls back to the Referer
 * header when Origin is absent — this covers HTML form submissions where
 * some browsers omit Origin but still send Referer.
 *
 * Returns true if the request origin is valid, false otherwise.
 * Returns false when SITE_URL is not configured.
 */
export function verifyCsrf(request: Request): boolean {
  const siteUrl = env.SITE_URL;
  if (!siteUrl) return false;
  const expectedOrigin = new URL(siteUrl).origin;

  const origin = request.headers.get("Origin");
  if (origin) {
    return origin === expectedOrigin;
  }

  // Fallback: check Referer header (covers HTML form POST where Origin may be absent)
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  return false;
}
