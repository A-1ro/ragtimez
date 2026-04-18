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
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    for (const domain of OFFICIAL_DOMAINS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
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
