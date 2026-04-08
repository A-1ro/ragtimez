import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  consumeOAuthState,
  createSession,
  buildSessionCookie,
} from "../../../lib/session";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUserResponse {
  login: string;
  avatar_url: string;
}

/**
 * GET /api/auth/callback
 *
 * Handles the GitHub OAuth callback:
 * 1. Validates the `state` parameter to prevent CSRF attacks.
 * 2. Exchanges the authorization `code` for an access token.
 * 3. Fetches the authenticated GitHub user's profile.
 * 4. Creates a server-side session stored in KV.
 * 5. Sets an HttpOnly session cookie and redirects to the home page.
 */
export const GET: APIRoute = async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return new Response("Missing required OAuth parameters: code and state", {
      status: 400,
    });
  }

  if (!env.AUTH_KV) {
    return new Response(
      JSON.stringify({ error: "AUTH_KV binding is not available" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return new Response(
      JSON.stringify({ error: "GitHub OAuth credentials are not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Verify the one-time CSRF state token.
  const stateValid = await consumeOAuthState(env.AUTH_KV, state);
  if (!stateValid) {
    return new Response("Invalid or expired OAuth state parameter", {
      status: 400,
    });
  }

  // Exchange the authorization code for an access token.
  let tokenData: GitHubTokenResponse;
  try {
    const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      return new Response("Failed to exchange authorization code for token", {
        status: 502,
      });
    }

    tokenData = (await tokenResponse.json()) as GitHubTokenResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      `Failed to contact GitHub token endpoint: ${message}`,
      { status: 502 }
    );
  }

  if (!tokenData.access_token) {
    const detail = tokenData.error_description ?? tokenData.error ?? "unknown";
    return new Response(`GitHub OAuth error: ${detail}`, { status: 502 });
  }

  // Fetch the authenticated user's GitHub profile.
  let userData: GitHubUserResponse;
  try {
    const userResponse = await fetch(GITHUB_USER_URL, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "ai-tech-daily/1.0 (https://github.com/A-1ro/ai-tech-daily)",
      },
    });

    if (!userResponse.ok) {
      return new Response("Failed to fetch GitHub user profile", {
        status: 502,
      });
    }

    userData = (await userResponse.json()) as GitHubUserResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Failed to contact GitHub API: ${message}`, {
      status: 502,
    });
  }

  // Create a server-side session and issue a cookie.
  const sessionId = await createSession(env.AUTH_KV, {
    login: userData.login,
    avatarUrl: userData.avatar_url,
  });

  const isSecure = new URL(request.url).protocol === "https:";

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": buildSessionCookie(sessionId, isSecure),
    },
  });
};
