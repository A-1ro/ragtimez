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

/**
 * Store a one-time OAuth state token in KV with a short TTL.
 */
export async function saveOAuthState(
  kv: KVNamespace,
  state: string
): Promise<void> {
  await kv.put(`oauth_state:${state}`, "1", {
    expirationTtl: OAUTH_STATE_TTL,
  });
}

/**
 * Verify that an OAuth state token exists and delete it (one-time use).
 * Returns `true` when the state is valid, `false` otherwise.
 *
 * NOTE: KV `get` + `delete` is not atomic.  Two concurrent requests carrying
 * the same `state` value could both succeed within the narrow window between
 * the two KV operations.  The short `OAUTH_STATE_TTL` (60 s) limits exposure.
 * A fully atomic implementation would require Durable Objects.
 */
export async function consumeOAuthState(
  kv: KVNamespace,
  state: string
): Promise<boolean> {
  const value = await kv.get(`oauth_state:${state}`);
  if (!value) return false;
  await kv.delete(`oauth_state:${state}`);
  return true;
}
