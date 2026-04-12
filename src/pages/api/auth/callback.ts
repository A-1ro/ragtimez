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
  id: number;
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
  const stateResult = await consumeOAuthState(env.AUTH_KV, state);
  if (!stateResult.valid) {
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

  // NOTE: tokenData.access_token must not be used below this point.
  // It is scoped only to the user-profile fetch above.

  // Validate the avatar URL to ensure it comes from GitHub's CDN and cannot
  // carry a javascript: URI or point to an attacker-controlled host.
  // URL parsing (rather than startsWith) is used so the origin check is
  // semantically precise and immune to tricks like
  // "https://avatars.githubusercontent.com.evil.com/".
  let parsedAvatar: URL | null;
  try {
    parsedAvatar = new URL(userData.avatar_url);
  } catch {
    parsedAvatar = null;
  }
  if (
    !parsedAvatar ||
    parsedAvatar.protocol !== "https:" ||
    parsedAvatar.hostname !== "avatars.githubusercontent.com"
  ) {
    return new Response("Unexpected avatar URL format", { status: 502 });
  }

  // Upsert the user record into D1 so that the profile page and FK constraints
  // work correctly from the very first login — before the user posts any note.
  //
  // Uses a true UPSERT (ON CONFLICT DO UPDATE) rather than INSERT OR REPLACE so
  // that existing notes rows referencing this github_id are never orphaned by a
  // DELETE+INSERT cycle, and so that profile columns (bio, *_url) set by the
  // user are not overwritten on subsequent logins.
  //
  // DB may be undefined in the local `npm run dev` environment (no Cloudflare
  // bindings), so we skip gracefully rather than blocking the OAuth flow.
  if (!env.DB) {
    console.warn("[auth/callback] DB binding is not available; skipping users upsert");
  } else {
    try {
      await env.DB.prepare(
        `INSERT INTO users (github_id, username, avatar_url, created_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(github_id) DO UPDATE SET
           username   = excluded.username,
           avatar_url = excluded.avatar_url`
      )
        .bind(String(userData.id), userData.login, userData.avatar_url)
        .run();
    } catch (err) {
      // Log but do not block session creation — a failed upsert must not
      // prevent the user from logging in.
      console.error("[auth/callback] users upsert failed", { error: String(err) });
    }
  }

  // Create a server-side session and issue a cookie.
  const sessionId = await createSession(env.AUTH_KV, {
    githubId: String(userData.id),
    login: userData.login,
    avatarUrl: userData.avatar_url,
  });

  const isSecure = new URL(request.url).protocol === "https:";

  // Redirect to the original destination (if one was stored in the OAuth state
  // payload) or fall back to the home page.  The returnTo path was validated
  // by validateReturnTo() in login.ts before being embedded in the state, so
  // it is safe to use directly here.
  const redirectLocation = stateResult.returnTo ?? "/";

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectLocation,
      "Set-Cookie": buildSessionCookie(sessionId, isSecure),
    },
  });
};
