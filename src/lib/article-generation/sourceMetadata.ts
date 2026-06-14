import type { ArticleSource, RssEntry } from "./types";

export const OFFICIAL_DOMAINS = [
  "openai.com",
  "anthropic.com",
  "deepmind.google",
  "microsoft.com",
  "azure.microsoft.com",
  "learn.microsoft.com",
  "aws.amazon.com",
  "ai.meta.com",
  "huggingface.co",
  "cloud.google.com",
  "research.google",
];

// Community forum / Q&A subdomains that host user-generated content.
// These must never be classified as "official" even when the parent domain is in OFFICIAL_DOMAINS.
const COMMUNITY_SUBDOMAINS = new Set([
  "discuss",
  "community",
  "forum",
  "forums",
  "answers",
  "qa",
  "support",
  "stackoverflow",
]);

export const BLOG_DOMAINS = [
  "medium.com",
  "dev.to",
  "hashnode.com",
  "substack.com",
  "techcrunch.com",
  "venturebeat.com",
  "zdnet.com",
  "infoq.com",
  "blog.langchain.dev",
];

export function classifySourceType(url: string): "official" | "blog" | "other" {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");

    for (const domain of OFFICIAL_DOMAINS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        // If the URL is on a subdomain (not the bare domain itself), check whether
        // that subdomain is a community forum / Q&A site.  Such pages are
        // user-generated content and must NOT receive "official" classification,
        // even when the parent domain (e.g. huggingface.co) is in OFFICIAL_DOMAINS.
        if (hostname !== domain) {
          const subdomain = hostname.split(".")[0];
          if (COMMUNITY_SUBDOMAINS.has(subdomain)) {
            return "other";
          }
        }

        // huggingface.co community blogs at /blog/{org}/{article} are not official —
        // they are authored by third parties (hackathon teams, individuals, etc.).
        // Only treat as official if it's a model card, dataset, space, or HF's own blog.
        if (domain === "huggingface.co") {
          const pathParts = parsed.pathname.split("/").filter(Boolean);
          // /blog/{org}/{article} (3+ parts) = community/org-scoped post → blog
          // /blog/{article}     (2 parts)  = HuggingFace first-party post  → official
          if (pathParts[0] === "blog" && pathParts.length >= 3) {
            return "blog";
          }
        }
        return "official";
      }
    }
    for (const domain of BLOG_DOMAINS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return "blog";
      }
    }
    if (hostname.split(".")[0] === "blog") {
      return "blog";
    }
    return "other";
  } catch {
    return "other";
  }
}

export function deriveTrustLevel(
  sources: { type: "official" | "blog" | "other" }[],
): "official" | "blog" | "speculative" {
  if (sources.length === 0) return "speculative";
  if (sources.some((s) => s.type === "official")) return "official";
  if (sources.some((s) => s.type === "blog")) return "blog";
  return "speculative";
}

export function extractSources(entries: RssEntry[]): ArticleSource[] {
  const seen = new Set<string>();
  const sources: ArticleSource[] = [];
  for (const entry of entries) {
    if (seen.has(entry.link)) continue;
    seen.add(entry.link);
    const type = classifySourceType(entry.link);
    sources.push({ url: entry.link, title: entry.title, type });
  }
  return sources;
}

/**
 * Filters sources to only those whose URLs appear in the article body as Markdown links.
 * Prevents irrelevant topic-selector entries from contaminating frontmatter.
 * If no URLs match (e.g., model used bare URLs), falls back to `fallbackSources` when
 * provided — callers passing a broad candidate list (all LLM context entries) should
 * supply the narrow topic-entry list here so the broad list never floods frontmatter —
 * otherwise to the full candidate list.
 */
export function filterSourcesByCited(
  body: string,
  sources: ArticleSource[],
  fallbackSources?: ArticleSource[],
): ArticleSource[] {
  const citedUrls = new Set<string>();
  // Handles standard `](url)`, title-bearing `](url "title")`, and angle-bracket `](<url>)` forms.
  const linkPattern = /\]\(\s*<?([^>\s)]+)>?(?:\s[^)]*)?\)/g;
  let match;
  while ((match = linkPattern.exec(body)) !== null) {
    citedUrls.add(match[1]);
  }
  const filtered = sources.filter((s) => citedUrls.has(s.url));
  if (filtered.length > 0) return filtered;
  return fallbackSources && fallbackSources.length > 0 ? fallbackSources : sources;
}
