import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { timingSafeEqual } from "../../../lib/auth";
import {
  listSubscribers,
  generateArticleEmailHtml,
  sendEmailViaResend,
} from "../../../lib/newsletter";

interface SendNewsletterRequest {
  articleSlug: string;
  articleTitle: string;
  articleSummary: string;
}

/**
 * POST /api/newsletter/send
 *
 * Internal endpoint for sending newsletter articles to all subscribers.
 * Requires Bearer token authentication using INTERNAL_API_TOKEN.
 *
 * Request body:
 *   {
 *     "articleSlug": "2026-04-11-article-title",
 *     "articleTitle": "Article Title",
 *     "articleSummary": "Brief summary of the article..."
 *   }
 *
 * Response (200):
 *   { "ok": true, "sent": N, "failed": M, "errors": [...] }
 *
 * Error responses:
 *   400 – missing or invalid request body
 *   401 – missing or invalid Authorization header
 *   500 – KV or Resend binding unavailable
 *   502 – Resend API error or batch send failures
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

  // Validate required bindings.
  if (!env.SUBSCRIBERS_KV) {
    return new Response(
      JSON.stringify({ error: "SUBSCRIBERS_KV binding is not available" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!env.RESEND_API_KEY || !env.NEWSLETTER_FROM_EMAIL || !env.SITE_URL) {
    return new Response(
      JSON.stringify({ error: "Newsletter configuration is incomplete" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse request body.
  let body: SendNewsletterRequest;
  try {
    body = (await request.json()) as SendNewsletterRequest;
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

  // Fetch all subscribers.
  let subscribers;
  try {
    subscribers = await listSubscribers(env.SUBSCRIBERS_KV);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Failed to fetch subscribers: ${message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  if (subscribers.length === 0) {
    return new Response(
      JSON.stringify({
        ok: true,
        sent: 0,
        failed: 0,
        errors: [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build article URL.
  const articleUrl = new URL(
    `/articles/${articleSlug}`,
    env.SITE_URL
  ).href;

  // Send emails in batches (5 parallel).
  const sent: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];
  const batchSize = 5;

  for (let i = 0; i < subscribers.length; i += batchSize) {
    const batch = subscribers.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (subscriber) => {
        try {
          const unsubscribeUrl = new URL(
            `/api/newsletter/unsubscribe?token=${encodeURIComponent(subscriber.token)}`,
            env.SITE_URL
          ).href;

          await sendEmailViaResend(
            env.RESEND_API_KEY,
            env.NEWSLETTER_FROM_EMAIL,
            subscriber.email,
            `[RAGtimeZ] 新着記事: ${articleTitle}`,
            generateArticleEmailHtml(
              articleTitle,
              articleSummary,
              articleUrl,
              unsubscribeUrl
            )
          );

          sent.push(subscriber.email);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failed.push({
            email: subscriber.email,
            error: message,
          });
        }
      })
    );
  }

  const statusCode = failed.length > 0 ? 502 : 200;

  return new Response(
    JSON.stringify({
      ok: failed.length === 0,
      sent: sent.length,
      failed: failed.length,
      errors: failed,
    }),
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    }
  );
};
