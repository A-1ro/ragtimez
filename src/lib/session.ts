/**
 * Session management utilities for GitHub OAuth authentication.
 *
 * Sessions are stored in Cloudflare KV under the key `session:{sessionId}`.
 * OAuth CSRF state tokens are stored under `oauth_state:{state}`.
 *
 * The session ID is transmitted as an HttpOnly cookie named `session_id`.
 */

export const SESSION_COOKIE = "session_id";

/** Session lifetime in seconds (7 days). */
export const SESSION_TTL = 7 * 24 * 60 * 60;

/** OAuth state lifetime in seconds (60 seconds).
 *
 * NOTE: KV's `get → delete` sequence is NOT atomic.  Two concurrent callbacks
 * with the same `state` could both pass validation in a narrow time window.
 * The short TTL (60 s) minimises the race window.  A fully atomic solution
 * would require Durable Objects transactions.
 */
export const OAUTH_STATE_TTL = 60;

/** Data stored in a session. */
export interface UserSession {
  githubId: string;
  login: string;
  avatarUrl: string;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/** UUID v4 pattern used to validate session IDs before KV lookups. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Extract the session ID from the `Cookie` request header.
 * Returns `null` if the cookie is absent or the value is not a valid UUID.
 */
export function getSessionId(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)session_id=([^;]+)/);
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  // Only accept well-formed UUID v4 values to prevent unexpected KV lookups.
  return UUID_RE.test(value) ? value : null;
}

/**
 * Build a `Set-Cookie` header value that creates the session cookie.
 * The `Secure` flag is only included when the request was made over HTTPS
 * so that local development (`wrangler pages dev`) still works.
 */
export function buildSessionCookie(sessionId: string, secure: boolean): string {
  const flags = [
    `HttpOnly`,
    `SameSite=Lax`,
    `Path=/`,
    `Max-Age=${SESSION_TTL}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  return `${SESSION_COOKIE}=${sessionId}; ${flags}`;
}

/**
 * Build a `Set-Cookie` header value that clears the session cookie.
 */
export function buildClearCookie(secure: boolean): string {
  const flags = [
    `HttpOnly`,
    `SameSite=Lax`,
    `Path=/`,
    `Max-Age=0`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  return `${SESSION_COOKIE}=; ${flags}`;
}

// ---------------------------------------------------------------------------
// KV session operations
// ---------------------------------------------------------------------------

/**
 * Look up an existing session by its ID.
 * Returns `null` if the session does not exist or the stored JSON is invalid.
 */
export async function getSession(
  kv: KVNamespace,
  sessionId: string
): Promise<UserSession | null> {
  const data = await kv.get(`session:${sessionId}`);
  if (!data) return null;
  try {
    return JSON.parse(data) as UserSession;
  } catch {
    return null;
  }
}

/**
 * Persist a new session in KV.
 * Returns the generated session ID (a random UUID).
 */
export async function createSession(
  kv: KVNamespace,
  user: UserSession
): Promise<string> {
  const sessionId = crypto.randomUUID();
  await kv.put(`session:${sessionId}`, JSON.stringify(user), {
    expirationTtl: SESSION_TTL,
  });
  return sessionId;
}

/**
 * Delete a session from KV.
 * Safe to call even if the session does not exist.
 */
export async function deleteSession(
  kv: KVNamespace,
  sessionId: string
): Promise<void> {
  await kv.delete(`session:${sessionId}`);
}

// ---------------------------------------------------------------------------
// OAuth CSRF state helpers
// ---------------------------------------------------------------------------

/** Shape of the value stored in KV for each OAuth state token. */
interface OAuthStatePayload {
  returnTo?: string;
}

/** Result returned by `consumeOAuthState`. */
export interface ConsumeOAuthStateResult {
  valid: boolean;
  returnTo?: string;
}

/**
 * Validate a `returnTo` path to prevent open-redirect attacks.
 *
 * Rules (all must pass):
 *   - Must be a non-empty string.
 *   - Must start with `/` (rejects absolute URLs such as `https://evil.com`).
 *   - Must NOT start with `//` (rejects protocol-relative URLs like `//evil.com`).
 *   - Must NOT contain a backslash (blocks browser-specific redirect tricks).
 *   - Must NOT contain tab, CR, or LF characters (prevents header injection
 *     and proxy normalisation tricks).
 *
 * Returns the validated path when all rules pass, or `undefined` otherwise.
 */
export function validateReturnTo(
  path: string | null | undefined
): string | undefined {
  if (!path) return undefined;
  if (!path.startsWith("/")) return undefined;
  if (path.startsWith("//")) return undefined;
  if (path.includes("\\")) return undefined;
  if (/[\t\r\n]/.test(path)) return undefined;
  return path;
}

/**
 * Store a one-time OAuth state token in KV with a short TTL.
 * An optional `returnTo` path is embedded in the stored value so that the
 * callback handler can redirect the user back to their original destination.
 */
export async function saveOAuthState(
  kv: KVNamespace,
  state: string,
  returnTo?: string
): Promise<void> {
  const payload: OAuthStatePayload = returnTo ? { returnTo } : {};
  await kv.put(`oauth_state:${state}`, JSON.stringify(payload), {
    expirationTtl: OAUTH_STATE_TTL,
  });
}

/**
 * Verify that an OAuth state token exists and delete it (one-time use).
 * Returns `{ valid: true, returnTo? }` when the state is valid, or
 * `{ valid: false }` when the token is absent or expired.
 *
 * NOTE: KV `get` + `delete` is not atomic.  Two concurrent requests carrying
 * the same `state` value could both succeed within the narrow window between
 * the two KV operations.  The short `OAUTH_STATE_TTL` (60 s) limits exposure.
 * A fully atomic implementation would require Durable Objects.
 */
export async function consumeOAuthState(
  kv: KVNamespace,
  state: string
): Promise<ConsumeOAuthStateResult> {
  const raw = await kv.get(`oauth_state:${state}`);
  if (!raw) return { valid: false };
  await kv.delete(`oauth_state:${state}`);

  // Parse the stored JSON payload.  Fall back gracefully if the stored value
  // is the legacy plain-string "1" (written before this change).
  let payload: OAuthStatePayload = {};
  try {
    payload = JSON.parse(raw) as OAuthStatePayload;
  } catch {
    // Legacy value — treat as valid state with no returnTo.
  }

  return {
    valid: true,
    ...(payload.returnTo ? { returnTo: payload.returnTo } : {}),
  };
}
