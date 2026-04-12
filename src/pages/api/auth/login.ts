import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { saveOAuthState, validateReturnTo } from "../../../lib/session";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

/**
 * GET /api/auth/login
 *
 * Initiates the GitHub OAuth flow:
 * 1. Generates a random CSRF `state` token and stores it in KV.
 * 2. Redirects the user to GitHub's OAuth authorization page.
 *
 * The `redirect_uri` is derived from the incoming request so that the
 * callback URL automatically matches the deployment environment (local,
 * preview, or production).
 */
export const GET: APIRoute = async ({ request }) => {
  if (!env.AUTH_KV) {
    return new Response(
      JSON.stringify({ error: "AUTH_KV binding is not available" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!env.GITHUB_CLIENT_ID) {
    return new Response(
      JSON.stringify({ error: "GITHUB_CLIENT_ID is not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate the optional returnTo query parameter before embedding it in the
  // OAuth state payload.  validateReturnTo rejects external URLs, protocol-
  // relative URLs, and backslash-containing paths.
  const rawReturnTo = new URL(request.url).searchParams.get("returnTo");
  const returnTo = validateReturnTo(rawReturnTo);

  // Generate and persist a one-time CSRF state token, embedding returnTo.
  const state = crypto.randomUUID();
  await saveOAuthState(env.AUTH_KV, state, returnTo);

  // Build the GitHub authorization URL.
  const redirectUri = new URL("/api/auth/callback", request.url).href;
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "read:user",
    state,
  });

  return Response.redirect(`${GITHUB_AUTHORIZE_URL}?${params}`, 302);
};
