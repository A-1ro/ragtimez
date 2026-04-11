/**
 * Profile URL validation for contributor profile links.
 *
 * Uses URL parsing (not startsWith) to ensure hostname checks are
 * semantically precise and immune to tricks like
 * "https://github.com.evil.com/" — the same technique used in
 * src/pages/api/auth/callback.ts for avatar URL validation.
 */

/** Platforms that accept profile links. */
export type ProfilePlatform = "github" | "x" | "linkedin";

/** Discriminated union returned by `validateProfileUrl`. */
export type ProfileUrlResult =
  | { valid: true; url: string | null }
  | { valid: false; error: string };

/** Maximum allowed URL length in characters. */
const MAX_URL_LENGTH = 500;

/** Allowed hostnames per platform. */
const ALLOWED_HOSTNAMES: Record<ProfilePlatform, readonly string[]> = {
  github:   ["github.com",   "www.github.com"],
  x:        ["x.com",        "www.x.com",        "twitter.com", "www.twitter.com"],
  linkedin: ["linkedin.com", "www.linkedin.com"],
};

/**
 * Validate a profile URL for a specific platform.
 *
 * - Empty / null / undefined values are accepted and treated as "clear the
 *   field" (returns `{ valid: true, url: null }`).
 * - Non-empty values must be an https URL whose hostname is on the allowlist
 *   for the given platform.
 * - Max length is 500 characters.
 *
 * @param url      The raw URL string supplied by the user.
 * @param platform Target social platform.
 */
export function validateProfileUrl(
  url: string | null | undefined,
  platform: ProfilePlatform
): ProfileUrlResult {
  // Treat empty / null / undefined as "clear the field".
  if (url == null || url.trim() === "") {
    return { valid: true, url: null };
  }

  const trimmed = url.trim();

  if (trimmed.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      error: `URL must not exceed ${MAX_URL_LENGTH} characters`,
    };
  }

  // Parse the URL — this is the authoritative check that prevents hostname
  // spoofing via path tricks.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  // Require HTTPS.
  if (parsed.protocol !== "https:") {
    return { valid: false, error: "URL must use HTTPS" };
  }

  // Hostname allowlist check.
  const allowed = ALLOWED_HOSTNAMES[platform];
  if (!allowed.includes(parsed.hostname)) {
    return {
      valid: false,
      error: `URL must be a valid ${platform} profile URL`,
    };
  }

  return { valid: true, url: trimmed };
}
