import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { subscribeEmail, generateConfirmationEmailHtml, sendEmailViaResend } from "../../../lib/newsletter";

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
  let subscriber;
  try {
    subscriber = await subscribeEmail(env.SUBSCRIBERS_KV, email);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Subscription failed: ${message}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Send confirmation email.
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
