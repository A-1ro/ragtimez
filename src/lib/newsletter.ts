/**
 * Newsletter subscription and sending utilities.
 *
 * Subscribers are stored in KV with two types of keys:
 * - `sub:<emailHash>` — stores Subscriber object (email, token, subscribedAt)
 * - `tok:<token>` — stores email (for unsubscribe lookup)
 *
 * Email hashes use SHA-256 to prevent timing attacks during duplicate checks.
 */

import { timingSafeEqual } from "./auth";

/**
 * Escape HTML special characters to prevent XSS attacks.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Represents a newsletter subscriber.
 */
export interface Subscriber {
  email: string;
  token: string;
  subscribedAt: string;
}

/**
 * Simple RFC5322-like email validation.
 * Rejects obviously invalid formats but is not a complete RFC implementation.
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * Compute SHA-256 hash of a string and return hex representation.
 * Used for email hashing to prevent timing attacks during duplicate checks.
 */
async function sha256Hash(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Normalize an email address (lowercase and trim) for consistent comparison.
 */
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Subscribe an email address to the newsletter.
 * Returns the newly created subscriber.
 * If the email is already subscribed, returns success silently (to prevent email enumeration).
 *
 * @param kv KV namespace for subscribers
 * @param email Email address to subscribe
 * @returns The created or existing subscriber
 * @throws Error if email validation fails or KV operation fails
 */
export async function subscribeEmail(
  kv: KVNamespace,
  email: string
): Promise<Subscriber> {
  const normalized = normalizeEmail(email);

  if (!isValidEmail(normalized)) {
    throw new Error("Invalid email format");
  }

  const emailHash = await sha256Hash(normalized);
  const existingKey = `sub:${emailHash}`;

  // Check if email is already subscribed (constant-time to prevent enumeration).
  const existing = await kv.get(existingKey);
  if (existing) {
    return JSON.parse(existing) as Subscriber;
  }

  // Generate unsubscribe token.
  const token = crypto.randomUUID();

  const subscriber: Subscriber = {
    email: normalized,
    token,
    subscribedAt: new Date().toISOString(),
  };

  // Store in KV with both lookups: email→subscriber and token→email.
  await Promise.all([
    kv.put(existingKey, JSON.stringify(subscriber), {
      expirationTtl: 365 * 24 * 60 * 60, // 1 year
    }),
    kv.put(`tok:${token}`, normalized, {
      expirationTtl: 365 * 24 * 60 * 60, // 1 year
    }),
  ]);

  return subscriber;
}

/**
 * Unsubscribe an email address using its unsubscribe token.
 * Returns true if the unsubscribe was successful, false if token is invalid.
 *
 * @param kv KV namespace for subscribers
 * @param token Unsubscribe token
 * @returns true if unsubscribed, false if token not found
 */
export async function unsubscribeByToken(
  kv: KVNamespace,
  token: string
): Promise<boolean> {
  // Look up email by token.
  const email = await kv.get(`tok:${token}`);
  if (!email) {
    return false;
  }

  // Delete both keys.
  const emailHash = await sha256Hash(email);
  await Promise.all([
    kv.delete(`sub:${emailHash}`),
    kv.delete(`tok:${token}`),
  ]);

  return true;
}

/**
 * Retrieve all subscribers from KV.
 *
 * @param kv KV namespace for subscribers
 * @returns Array of all subscribers
 */
export async function listSubscribers(kv: KVNamespace): Promise<Subscriber[]> {
  const subscribers: Subscriber[] = [];
  let cursor: string | undefined;

  // KV.list() returns paginated results; iterate through all pages.
  do {
    const result = await kv.list({ prefix: "sub:", cursor });
    for (const item of result.keys) {
      const data = await kv.get(item.name);
      if (data) {
        try {
          subscribers.push(JSON.parse(data) as Subscriber);
        } catch {
          // Skip malformed entries.
        }
      }
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return subscribers;
}

/**
 * Send an email via the Resend API.
 * Throws an error if the request fails.
 *
 * @param apiKey Resend API key
 * @param from Sender email address (must be verified in Resend)
 * @param to Recipient email address
 * @param subject Email subject
 * @param html Email body (HTML format)
 */
export async function sendEmailViaResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend API error (${response.status}): ${errorText}`);
  }
}

/**
 * Generate an HTML email template for subscription confirmation.
 */
export function generateConfirmationEmailHtml(
  unsubscribeUrl: string
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 2px solid #3d8ef5; padding-bottom: 20px; margin-bottom: 20px; }
    .content { margin: 20px 0; }
    .footer { border-top: 1px solid #ddd; padding-top: 20px; margin-top: 40px; font-size: 0.875rem; color: #666; }
    .unsubscribe { margin-top: 20px; padding: 10px; background: #f5f5f5; border-radius: 4px; }
    .unsubscribe a { color: #3d8ef5; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; color: #080c1e;">RAGtimeZ</h1>
    </div>
    <div class="content">
      <p>RAGtimeZニュースレター購読ありがとうございます。</p>
      <p>これから新着記事をお届けします。Azure、LLM、RAG、AIエージェントに関する最新の技術情報をお楽しみください。</p>
    </div>
    <div class="unsubscribe">
      <p style="margin: 0; font-size: 0.875rem; color: #666;">
        配信を停止したい場合は、<a href="${unsubscribeUrl}">こちら</a>から購読を解除できます。
      </p>
    </div>
    <div class="footer">
      <p>&copy; RAGtimeZ. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate an HTML email template for article notification.
 */
export function generateArticleEmailHtml(
  articleTitle: string,
  articleSummary: string,
  articleUrl: string,
  unsubscribeUrl: string
): string {
  // Escape user-provided content to prevent XSS attacks.
  const escapedTitle = escapeHtml(articleTitle);
  const escapedSummary = escapeHtml(articleSummary);
  const escapedArticleUrl = escapeHtml(articleUrl);
  const escapedUnsubscribeUrl = escapeHtml(unsubscribeUrl);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 2px solid #3d8ef5; padding-bottom: 20px; margin-bottom: 20px; }
    .article { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3d8ef5; }
    .article h2 { margin: 0 0 10px; color: #080c1e; font-size: 1.25rem; }
    .article p { margin: 0 0 15px; color: #555; }
    .cta-btn { display: inline-block; padding: 12px 24px; background: #3d8ef5; color: white; text-decoration: none; border-radius: 4px; font-weight: 600; margin: 20px 0; }
    .footer { border-top: 1px solid #ddd; padding-top: 20px; margin-top: 40px; font-size: 0.875rem; color: #666; }
    .unsubscribe { margin-top: 20px; padding: 10px; background: #f5f5f5; border-radius: 4px; }
    .unsubscribe a { color: #3d8ef5; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; color: #080c1e;">RAGtimeZ</h1>
      <p style="margin: 8px 0 0; color: #666; font-size: 0.875rem;">新着記事をお知らせします</p>
    </div>
    <div class="article">
      <h2>${escapedTitle}</h2>
      <p>${escapedSummary}</p>
      <a href="${escapedArticleUrl}" class="cta-btn">記事を読む</a>
    </div>
    <div class="footer">
      <p>RAGtimeZニュースレターの配信を停止したい場合は、<a href="${escapedUnsubscribeUrl}">こちら</a>から購読を解除できます。</p>
      <p>&copy; RAGtimeZ. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}
