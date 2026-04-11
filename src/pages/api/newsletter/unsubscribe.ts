import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { unsubscribeByToken } from "../../../lib/newsletter";

/**
 * GET /api/newsletter/unsubscribe?token=<token>
 * POST /api/newsletter/unsubscribe (with token in body or query)
 *
 * Unsubscribes an email address from the newsletter using the unsubscribe token.
 * Returns an HTML page with a success or failure message.
 * Both GET and POST are supported for compatibility with email clients.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!env.SUBSCRIBERS_KV) {
    return new Response(
      "Unsubscribe service is temporarily unavailable. Please try again later.",
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return buildHtmlResponse(
      "Unsubscribe Failed",
      "Invalid or missing unsubscribe token.",
      false
    );
  }

  const success = await unsubscribeByToken(env.SUBSCRIBERS_KV, token);

  if (success) {
    return buildHtmlResponse(
      "購読を解除しました",
      "RAGtimeZニュースレターの購読を解除しました。ご利用ありがとうございました。",
      true
    );
  } else {
    return buildHtmlResponse(
      "購読解除に失敗しました",
      "トークンが無効または期限切れです。別のリンクをお試しください。",
      false
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  if (!env.SUBSCRIBERS_KV) {
    return new Response(
      JSON.stringify({ error: "Unsubscribe service is temporarily unavailable" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Try to extract token from query params or form body.
  const { searchParams } = new URL(request.url);
  let token = searchParams.get("token");

  if (!token) {
    try {
      const formData = await request.formData();
      token = formData.get("token")?.toString() || null;
    } catch {
      // Ignore form parsing errors
    }
  }

  if (!token) {
    return new Response(
      JSON.stringify({ error: "Missing token parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const success = await unsubscribeByToken(env.SUBSCRIBERS_KV, token);

  if (success) {
    return new Response(
      JSON.stringify({ ok: true, message: "Unsubscribed successfully" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } else {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid or expired token",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
};

/**
 * Build an HTML response for unsubscribe success/failure pages.
 */
function buildHtmlResponse(
  title: string,
  message: string,
  success: boolean
): Response {
  const statusColor = success ? "#22c55e" : "#ef4444";
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #080c1e;
      color: #e4ebff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      max-width: 500px;
      padding: 2rem;
      text-align: center;
    }
    .icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.5rem;
      color: ${statusColor};
    }
    p {
      margin: 0;
      color: #a1a8c8;
      line-height: 1.6;
    }
    .home-link {
      display: inline-block;
      margin-top: 2rem;
      padding: 0.75rem 1.5rem;
      background: #3d8ef5;
      color: white;
      text-decoration: none;
      border-radius: 0.5rem;
      font-weight: 600;
      transition: background 0.2s;
    }
    .home-link:hover {
      background: #6aabff;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${success ? "✓" : "✕"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/" class="home-link">RAGtimeZに戻る</a>
  </div>
</body>
</html>
  `;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
