import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  subscribeEmail,
  generateConfirmationEmailHtml,
  sendEmailViaResend,
} from "../../../lib/newsletter";

/**
 * POST /api/newsletter/subscribe
 *
 * Subscribes an email address to the newsletter.
 * Accepts both application/json and application/x-www-form-urlencoded content types.
 *
 * Request body:
 *   { "email": "user@example.com" }  (JSON)
 *   or email=user@example.com (form-encoded)
 *
 * Response (200):
 *   { "ok": true }
 *
 * Error responses:
 *   400 – missing email parameter, invalid email format, or invalid content type
 *   403 – CSRF check failed (Origin mismatch)
 *   429 – rate limit exceeded (1 request per IP per 60 seconds)
 *   500 – KV or Resend binding unavailable
 *   502 – Resend API error or email send failed
 */
export const POST: APIRoute = async ({ request }) => {
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

  // Rate limiting: 1 request per IP per 60 seconds.
  // Checked before CSRF validation to reduce processing cost for abusive requests.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const rateKey = `rate:subscribe:${ip}`;
  const recent = await env.SUBSCRIBERS_KV.get(rateKey);
  if (recent) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please try again later." }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }
  await env.SUBSCRIBERS_KV.put(rateKey, "1", { expirationTtl: 60 });

  // CSRF check: verify Origin matches SITE_URL.
  const origin = request.headers.get("Origin");
  const siteUrl = new URL(env.SITE_URL);
  if (!origin || !origin.startsWith(siteUrl.origin)) {
    return new Response(
      JSON.stringify({ error: "CSRF validation failed" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse email from request body.
  let email: string | null = null;
  const contentType = request.headers.get("Content-Type") || "";

  try {
    if (contentType.includes("application/json")) {
      const body = await request.json() as { email?: string };
      email = body.email;
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      email = formData.get("email")?.toString() || null;
    } else if (!contentType || contentType === "text/plain") {
      // Allow form submission without explicit content-type
      try {
        const formData = await request.formData();
        email = formData.get("email")?.toString() || null;
      } catch {
        // If form parsing fails, try JSON
        try {
          const body = await request.json() as { email?: string };
          email = body.email;
        } catch {
          // Neither worked
        }
      }
    } else {
      return new Response(
        JSON.stringify({ error: "Unsupported Content-Type" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to parse request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!email || typeof email !== "string") {
    return new Response(
      JSON.stringify({ error: "Missing or invalid email parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Subscribe the email.
  let subscribeResult;
  try {
    subscribeResult = await subscribeEmail(env.SUBSCRIBERS_KV, email);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Subscription failed: ${message}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { subscriber, isNew } = subscribeResult;

  // Skip confirmation email for already-subscribed addresses.
  // Return 200 to avoid leaking subscription status (prevents email enumeration).
  if (!isNew) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Send confirmation email for new subscribers.
  const unsubscribeUrl = new URL(
    `/api/newsletter/unsubscribe?token=${encodeURIComponent(subscriber.token)}`,
    env.SITE_URL
  ).href;

  try {
    await sendEmailViaResend(
      env.RESEND_API_KEY,
      env.NEWSLETTER_FROM_EMAIL,
      subscriber.email,
      "RAGtimeZニュースレター購読ありがとうございます",
      generateConfirmationEmailHtml(unsubscribeUrl)
    );
  } catch (err) {
    // Email send failed, but subscriber was added to KV.
    // Return 502 to indicate a transient service issue.
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Email send failed: ${message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
