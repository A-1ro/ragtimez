import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getSessionId, deleteSession, buildClearCookie } from "../../../lib/session";

/**
 * POST /api/auth/logout
 *
 * Ends the current session:
 * 1. Reads the session ID from the request cookie.
 * 2. Deletes the session record from KV.
 * 3. Clears the session cookie.
 * 4. Redirects the user to the home page.
 *
 * POST is used (rather than GET) so that logout cannot be triggered by
 * an attacker embedding a hidden image or link (CSRF via logout).
 */
export const POST: APIRoute = async ({ request }) => {
  const sessionId = getSessionId(request);
  if (sessionId && env.AUTH_KV) {
    await deleteSession(env.AUTH_KV, sessionId);
  }

  const isSecure = new URL(request.url).protocol === "https:";

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": buildClearCookie(isSecure),
    },
  });
};
