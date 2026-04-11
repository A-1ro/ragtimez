/**
 * Bluesky (AT Protocol) utilities for posting articles to Bluesky.
 *
 * This module uses only native fetch API (no external dependencies)
 * to be compatible with Cloudflare Workers environment.
 */

interface BlueskySession {
  accessJwt: string;
  did: string;
}

/**
 * Create a Bluesky session using identifier and app password.
 * Authenticates against the AT Protocol server at bsky.social.
 */
export async function createBlueskySession(
  identifier: string,
  appPassword: string
): Promise<BlueskySession> {
  const response = await fetch(
    "https://bsky.social/xrpc/com.atproto.server.createSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier,
        password: appPassword,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Bluesky session creation failed: ${response.status} ${response.statusText} - ${body}`
    );
  }

  const data = (await response.json()) as {
    accessJwt: string;
    did: string;
  };
  return {
    accessJwt: data.accessJwt,
    did: data.did,
  };
}

interface BlueskyPostOptions {
  accessJwt: string;
  did: string;
  text: string;
  linkUrl: string;
  linkTitle: string;
  linkDescription: string;
}

interface BlueskyPostRecord {
  $type: "app.bsky.feed.post";
  text: string;
  createdAt: string;
  facets: Array<{
    index: {
      byteStart: number;
      byteEnd: number;
    };
    features: Array<{
      $type: "app.bsky.richtext.facet#link";
      uri: string;
    }>;
  }>;
  embed: {
    $type: "app.bsky.embed.external";
    external: {
      uri: string;
      title: string;
      description: string;
    };
  };
}

/**
 * Calculate the UTF-8 byte start and end positions of a substring within text.
 * Used for building facets (rich text formatting) in Bluesky posts.
 * Searches for the last occurrence of the substring (URL typically appears once at the end).
 */
function getByteIndices(
  text: string,
  substring: string
): { start: number; end: number } | null {
  const index = text.lastIndexOf(substring);
  if (index === -1) return null;

  const encoder = new TextEncoder();
  const before = text.slice(0, index);
  const withSubstring = text.slice(0, index + substring.length);

  const byteStart = encoder.encode(before).length;
  const byteEnd = encoder.encode(withSubstring).length;

  return { start: byteStart, end: byteEnd };
}

/**
 * Post to Bluesky with article link and rich text facets.
 * Includes the article URL as a link facet and embeds the link preview.
 */
export async function postToBluesky(
  options: BlueskyPostOptions
): Promise<string> {
  const { accessJwt, did, text, linkUrl, linkTitle, linkDescription } =
    options;

  // Find byte positions of the URL in the text for facet
  const urlIndices = getByteIndices(text, linkUrl);
  if (!urlIndices) {
    throw new Error(`URL not found in post text: ${linkUrl}`);
  }

  const record: BlueskyPostRecord = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    facets: [
      {
        index: {
          byteStart: urlIndices.start,
          byteEnd: urlIndices.end,
        },
        features: [
          {
            $type: "app.bsky.richtext.facet#link",
            uri: linkUrl,
          },
        ],
      },
    ],
    embed: {
      $type: "app.bsky.embed.external",
      external: {
        uri: linkUrl,
        title: linkTitle,
        description: linkDescription,
      },
    },
  };

  const response = await fetch(
    "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessJwt}`,
      },
      body: JSON.stringify({
        repo: did,
        collection: "app.bsky.feed.post",
        record,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Bluesky post creation failed: ${response.status} ${response.statusText} - ${body}`
    );
  }

  const result = (await response.json()) as { uri: string };
  return result.uri;
}

/**
 * Helper: count the length of a string in codepoints (not UTF-16 code units).
 */
function codepointLength(s: string): number {
  return Array.from(s).length;
}

/**
 * Helper: slice a string by codepoints (not UTF-16 code units).
 */
function codepointSlice(s: string, end: number): string {
  return Array.from(s).slice(0, end).join("");
}

/**
 * Build a Bluesky post text from article metadata.
 *
 * The text is constructed to fit within Bluesky's 300 grapheme limit.
 * Length calculations are done in codepoints to correctly handle emoji and other
 * multi-unit Unicode characters (e.g., "📝" as a single codepoint, not two code units).
 *
 * Format:
 * ```
 * <title>
 *
 * <truncated summary>
 *
 * <ctaText>
 * <url>
 * ```
 */
export function buildBlueskyPostText(
  title: string,
  summary: string,
  url: string,
  ctaText: string
): string {
  const BLUESKY_MAX_GRAPHEMES = 300;

  // Build the fixed parts around the summary
  const ctaPart = `\n\n${ctaText}\n${url}`;

  // Calculate overhead in codepoints (all parts except summary)
  const headerCodepoints = codepointLength(title);
  const ctaPartCodepoints = codepointLength(ctaPart);
  const newlineBeforeSummary = 2; // "\n\n"
  const totalOverhead = headerCodepoints + newlineBeforeSummary + ctaPartCodepoints;

  // Available space for summary in codepoints
  const availableForSummary = BLUESKY_MAX_GRAPHEMES - totalOverhead;

  // Truncate summary if needed, with ellipsis
  let finalSummary = summary;
  const summaryCodepoints = codepointLength(summary);
  if (availableForSummary < summaryCodepoints) {
    const maxSummaryCodepoints = Math.max(0, availableForSummary - 1); // -1 for ellipsis
    finalSummary = codepointSlice(summary, maxSummaryCodepoints) + "…";
  }

  // Build final text
  const text = `${title}\n\n${finalSummary}${ctaPart}`;

  return text;
}
