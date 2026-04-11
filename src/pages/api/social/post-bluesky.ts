import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { timingSafeEqual } from "../../../lib/auth";
import {
  createBlueskySession,
  postToBluesky,
  buildBlueskyPostText,
} from "../../../lib/bluesky";

interface PostBlueskyRequest {
  articleSlug: string;
  articleTitle: string;
  articleSummary: string;
}

/**
 * POST /api/social/post-bluesky
 *
 * Internal endpoint for posting articles to Bluesky.
 * Requires Bearer token authentication using INTERNAL_API_TOKEN.
 *
 * If Bluesky credentials are not configured, returns success with skipped=true
 * to avoid breaking the article generation workflow.
 *
 * Request body:
 *   {
 *     "articleSlug": "2026-04-11-article-title",
 *     "articleTitle": "Article Title",
 *     "articleSummary": "Brief summary of the article..."
 *   }
 *
 * Response (200):
 *   { "ok": true, "skipped": false, "uri": "<bluesky-post-uri>" }
 *   or
 *   { "ok": true, "skipped": true, "reason": "..." }
 *
 * Error responses:
 *   400 – missing or invalid request body
 *   401 – missing or invalid Authorization header
 *   502 – Bluesky API error
 */
export const POST: APIRoute = async ({ request }) => {
  // Authentication: constant-time token comparison.
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (
    !env.INTERNAL_API_TOKEN ||
    !token ||
    !timingSafeEqual(token, env.INTERNAL_API_TOKEN)
  ) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Check if Bluesky is configured (optional).
  if (!env.BLUESKY_IDENTIFIER || !env.BLUESKY_APP_PASSWORD || !env.SITE_URL) {
    return new Response(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: "Bluesky credentials not configured",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse request body.
  let body: PostBlueskyRequest;
  try {
    body = (await request.json()) as PostBlueskyRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { articleSlug, articleTitle, articleSummary } = body;

  if (
    !articleSlug ||
    !articleTitle ||
    !articleSummary ||
    typeof articleSlug !== "string" ||
    typeof articleTitle !== "string" ||
    typeof articleSummary !== "string"
  ) {
    return new Response(
      JSON.stringify({
        error: "Missing or invalid required fields: articleSlug, articleTitle, articleSummary",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build article URL.
  const articleUrl = new URL(
    `/articles/${articleSlug}`,
    env.SITE_URL
  ).href;

  // Build post text.
  const ctaText = "📝 この記事に注釈を追加できます";
  const postText = buildBlueskyPostText(
    articleTitle,
    articleSummary,
    articleUrl,
    ctaText
  );

  try {
    // Create a session with Bluesky.
    const session = await createBlueskySession(
      env.BLUESKY_IDENTIFIER,
      env.BLUESKY_APP_PASSWORD
    );

    // Post to Bluesky.
    const postUri = await postToBluesky({
      accessJwt: session.accessJwt,
      did: session.did,
      text: postText,
      linkUrl: articleUrl,
      linkTitle: articleTitle,
      linkDescription: articleSummary,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        skipped: false,
        uri: postUri,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
};
