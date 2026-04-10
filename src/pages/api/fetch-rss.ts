import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { timingSafeEqual } from "../../lib/auth";
import { CRAWL_TARGETS } from "../../constants/crawlTargets";

/**
 * POST /api/fetch-rss
 *
 * Fetches RSS feeds from all crawl targets and stores entries in D1.
 * Designed to run daily before article generation.
 *
 * Authentication:
 *   Requires `Authorization: Bearer <INTERNAL_API_TOKEN>` header.
 *
 * Response 200:
 *   { fetched: number, inserted: number, skipped: number, errors: Array<{source, message}> }
 *
 * Error responses:
 *   400 – invalid request
 *   401 – missing/invalid Authorization
 *   500 – DB binding unavailable
 *   502 – RSS fetch or database error
 */
export const POST: APIRoute = async ({ request }) => {
  // --- Auth ---
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (
    !env.INTERNAL_API_TOKEN ||
    !token ||
    !timingSafeEqual(token, env.INTERNAL_API_TOKEN)
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Binding checks ---
  if (!env.DB) {
    return new Response(
      JSON.stringify({
        error: "DB binding is not available in this environment",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Process all RSS feeds ---
  let fetchedCount = 0;
  let insertedCount = 0;
  let skippedCount = 0;
  const errors: Array<{ source: string; message: string }> = [];

  for (const target of CRAWL_TARGETS) {
    try {
      const entries = await fetchRssFeed(target.rssUrl);
      fetchedCount += entries.length;

      for (const entry of entries) {
        try {
          const result = await env.DB.prepare(
            `INSERT OR IGNORE INTO rss_entries
             (source_label, source_url, title, link, summary, published_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            target.label,
            target.url,
            entry.title,
            entry.link,
            entry.summary,
            entry.publishedAt
          ).run();

          // Check if a row was actually inserted (not ignored due to duplicate link)
          if (result.success && result.meta.changes > 0) {
            insertedCount++;
          } else {
            skippedCount++;
          }
        } catch (err) {
          errors.push({
            source: target.label,
            message: `Failed to insert entry "${entry.title}": ${String(err)}`,
          });
        }
      }
    } catch (err) {
      errors.push({
        source: target.label,
        message: `Failed to fetch RSS: ${String(err)}`,
      });
    }
  }

  return new Response(
    JSON.stringify({
      fetched: fetchedCount,
      inserted: insertedCount,
      skipped: skippedCount,
      errors,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};

// --- RSS Parsing ---

interface RssEntry {
  title: string;
  link: string;
  summary: string;
  publishedAt: string;
}

/**
 * Extract CDATA content from a string.
 * If the string contains a CDATA block, returns the content inside it.
 * Otherwise returns the original string.
 */
function extractCdata(raw: string): string {
  const cdataMatch = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return cdataMatch ? cdataMatch[1] : raw;
}

/**
 * Strip HTML tags from a string.
 * Collapses multiple spaces and trims the result.
 */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Parse a date string and return ISO string, or null if parsing fails.
 * Handles Invalid Date cases safely.
 */
function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw.trim());
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Parse RSS XML feed and extract entries.
 * Uses simple regex-based parsing since DOMParser is not available in Workers.
 */
async function fetchRssFeed(feedUrl: string): Promise<RssEntry[]> {
  const response = await fetch(feedUrl, {
    headers: {
      "User-Agent":
        "RAGtimeZ/1.0 (RSS Feed Aggregator; +https://ragtimez.com)",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const entries: RssEntry[] = [];

  // Extract all <item> or <entry> tags (RSS vs Atom)
  const itemPattern = /<(item|entry)([\s\S]*?)<\/\1>/g;
  let itemMatch;

  while ((itemMatch = itemPattern.exec(xml)) !== null) {
    const itemContent = itemMatch[2];
    const entry = parseRssItem(itemContent);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Extract title, link, summary, and published date from RSS item content.
 */
function parseRssItem(itemContent: string): RssEntry | null {
  // Extract title (works for both <title> in item and entry)
  const titleMatch = /<title(?:\s[^>]*)?>([^<]*)<\/title>/.exec(itemContent);
  const titleRaw = titleMatch ? titleMatch[1] : undefined;
  const title = titleRaw ? he(stripHtml(extractCdata(titleRaw))) : undefined;

  // Extract link (RSS uses <link> directly, Atom uses <link href="">)
  let linkMatch = /<link\s+href="([^"]+)"/.exec(itemContent);
  let link = linkMatch ? linkMatch[1] : undefined;
  if (!link) {
    linkMatch = /<link(?:\s[^>]*)?>([^<]+)<\/link>/.exec(itemContent);
    link = linkMatch ? linkMatch[1] : undefined;
  }

  // Extract summary (RSS: <description>, Atom: <summary>)
  // Two-branch regex: plain text [1] | CDATA content [3]. Use [1] ?? [3].
  let summaryMatch = /<description(?:\s[^>]*)?>([^<]*?)<\/description>|<description(?:\s[^>]*)?>(<!\[CDATA\[([\s\S]*?)\]\]>)<\/description>/.exec(
    itemContent
  );
  let summaryRaw = summaryMatch ? (summaryMatch[1] ?? summaryMatch[3]) : undefined;
  let summary = summaryRaw ? he(stripHtml(summaryRaw)) : undefined;

  if (!summary) {
    summaryMatch = /<summary(?:\s[^>]*)?>([^<]*?)<\/summary>|<summary(?:\s[^>]*)?>(<!\[CDATA\[([\s\S]*?)\]\]>)<\/summary>/.exec(itemContent);
    summaryRaw = summaryMatch ? (summaryMatch[1] ?? summaryMatch[3]) : undefined;
    summary = summaryRaw ? he(stripHtml(summaryRaw)) : undefined;
  }

  // Extract published date (RSS: <pubDate>, Atom: <published>)
  let pubDateMatch = /<pubDate(?:\s[^>]*)?>([^<]+)<\/pubDate>/.exec(itemContent);
  let publishedAt = pubDateMatch ? pubDateMatch[1] : undefined;
  if (!publishedAt) {
    pubDateMatch = /<published(?:\s[^>]*)?>([^<]+)<\/published>/.exec(itemContent);
    publishedAt = pubDateMatch ? pubDateMatch[1] : undefined;
  }

  // Normalize date to ISO string or null if parsing fails
  let normalizedDate: string | null = null;
  if (publishedAt) {
    normalizedDate = parseDate(publishedAt);
  }

  // Require at least title and link
  if (!title || !link) {
    return null;
  }

  return {
    title,
    link,
    summary: summary || "",
    publishedAt: normalizedDate || new Date().toISOString(),
  };
}

/**
 * Decode common HTML entities.
 * Handles &amp;, &lt;, &gt;, &quot;, &#39; and numeric entities like &#123;
 */
function he(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
}
