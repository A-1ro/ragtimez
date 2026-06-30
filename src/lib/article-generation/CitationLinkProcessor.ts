import type { ICitationLinkProcessor } from "./interfaces";

/** Normalise a URL for comparison: lowercase hostname, strip trailing slash and fragment. */
function normalizeForComparison(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

interface CitationFormat {
  /** Matches the marker that starts a citation footer, up to the end of its line. */
  lineRegex: RegExp;
  rebuild: (linkList: string) => string;
  placeholder: string;
}

const JA_FORMAT: CitationFormat = {
  lineRegex: /（出典:([^\n]*)$/gm,
  rebuild: (linkList) => `（出典: ${linkList}）`,
  placeholder: "（出典: 公式ドキュメントに記載なし）",
};

const EN_FORMAT: CitationFormat = {
  lineRegex: /\(Source:([^\n]*)$/gm,
  rebuild: (linkList) => `(Source: ${linkList})`,
  placeholder: "(Source: not detailed in official documentation)",
};

/**
 * Cleans up the citation footers ("（出典: ...）" / "(Source: ...)") that the
 * draft generator appends to each section.
 *
 * The system prompt asks for `（出典: [title](url)）`, but the draft model
 * (most often the Workers AI fallback, which follows formatting instructions
 * less reliably than the Anthropic model) sometimes mangles this in two ways
 * observed in production output:
 *
 * 1. Missing `[ ]` brackets — the model writes the URL as plain text directly
 *    followed by the same URL in parentheses, e.g. `https://a/b(https://a/b)`
 *    instead of `[https://a/b](https://a/b)`.
 * 2. Missing/mismatched closing punctuation — the footer can end with a bare
 *    ASCII `)` instead of the full-width `）`, or omit the closing character
 *    entirely.
 *
 * Because neither malformed form matches a `[...](url)` pattern, it used to
 * slip past both fabrication detection and the frontmatter
 * `filterSourcesByCited` check (sourceMetadata.ts), which both key off proper
 * Markdown link syntax. Left unfixed, "no cited links found" causes
 * `filterSourcesByCited` to fall back to the full candidate list — letting
 * off-topic sources the topic-relevance audit failed to drop leak into the
 * published frontmatter.
 *
 * Rather than trying to regex-match the model's (unreliable) closing
 * punctuation, this class treats everything from the marker (`（出典:` /
 * `(Source:`) to the end of that line as the footer, extracts whatever
 * `[text](url)` links it can find inside, and rebuilds the footer itself —
 * so the output is well-formed regardless of how the model closed it.
 */
export class CitationLinkProcessor implements ICitationLinkProcessor {
  process(body: string, allowedUrls: Set<string>): string {
    const normalized = this.normalizeBareLinks(body);
    const normalizedAllowed = new Set([...allowedUrls].map(normalizeForComparison));
    const isAllowed = (url: string) => normalizedAllowed.has(normalizeForComparison(url));

    let result = normalized;
    for (const format of [JA_FORMAT, EN_FORMAT]) {
      result = result.replace(format.lineRegex, (full, rest: string) =>
        this.rewriteFooterLine(full, rest, format, isAllowed),
      );
    }
    return result;
  }

  /** Converts `text(url)` (a Markdown link missing its `[ ]`) into `[text](url)`. */
  private normalizeBareLinks(body: string): string {
    return body.replace(
      /(https?:\/\/[^\s()]+)\((https?:\/\/[^\s()]+)\)/g,
      (_match, text: string, url: string) => `[${text}](${url})`,
    );
  }

  private rewriteFooterLine(
    full: string,
    rest: string,
    format: CitationFormat,
    isAllowed: (url: string) => boolean,
  ): string {
    const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
    const kept: string[] = [];
    let match: RegExpExecArray | null;
    let found = false;
    while ((match = linkRe.exec(rest)) !== null) {
      found = true;
      if (isAllowed(match[1])) {
        kept.push(match[0]);
      } else {
        console.warn(`捏造/未許可の出典URLを除去: ${match[1]}`);
      }
    }

    // No recognizable link at all — leave the line untouched rather than risk
    // mangling content this class wasn't designed to parse.
    if (!found) return full;

    return kept.length > 0 ? format.rebuild(kept.join(", ")) : format.placeholder;
  }
}
