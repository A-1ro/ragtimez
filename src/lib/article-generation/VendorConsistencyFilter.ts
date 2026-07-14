import type { IEntryRelevanceFilter } from "./interfaces";
import type { RssEntry } from "./types";

/**
 * Maps known official domains to a canonical vendor name so that domains
 * belonging to the same company (e.g. aws.amazon.com and docs.aws.amazon.com)
 * are grouped together, while genuinely different vendors are not merged
 * just because both happen to be "official" domains.
 */
const VENDOR_BY_DOMAIN: Record<string, string> = {
  "openai.com": "OpenAI",
  "community.openai.com": "OpenAI",
  "developers.openai.com": "OpenAI",
  "anthropic.com": "Anthropic",
  "deepmind.google": "Google",
  "microsoft.com": "Microsoft",
  "azure.microsoft.com": "Microsoft",
  "learn.microsoft.com": "Microsoft",
  "devblogs.microsoft.com": "Microsoft",
  "aws.amazon.com": "Amazon",
  "docs.aws.amazon.com": "Amazon",
  "ai.meta.com": "Meta",
  "huggingface.co": "HuggingFace",
  "discuss.huggingface.co": "HuggingFace",
  "cloud.google.com": "Google",
  "research.google": "Google",
  "blog.google": "Google",
};

function vendorOf(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (VENDOR_BY_DOMAIN[hostname]) return VENDOR_BY_DOMAIN[hostname];
    for (const [domain, vendor] of Object.entries(VENDOR_BY_DOMAIN)) {
      if (hostname.endsWith(`.${domain}`)) return vendor;
    }
    // Unknown domain: treat the hostname itself as its own vendor bucket so it
    // only survives when the anchor entry is from that exact same host.
    return hostname;
  } catch {
    return url;
  }
}

/**
 * Deterministic safety net against multi-vendor "roundup" articles.
 *
 * The topic-selection and relevance-audit LLM calls (TopicSelector) are both
 * instructed to keep entries about a single company's product or announcement,
 * but instruction-following is probabilistic. In practice this has repeatedly
 * let entries from unrelated vendors survive into the final draft context —
 * e.g. AWS Bedrock and SageMaker blog posts merged into a Hugging Face LeRobot
 * article — producing an article whose title covers one topic while later
 * sections drift into unrelated products from other companies.
 *
 * This filter re-checks the LLM's own output with plain code: it treats the
 * first (highest-relevance) entry as the topic anchor and drops any entry
 * belonging to a different vendor, guaranteeing the rule holds regardless of
 * whether the LLM audit caught it.
 */
export class VendorConsistencyFilter implements IEntryRelevanceFilter {
  filter(entries: RssEntry[]): { entries: RssEntry[]; droppedDomains: string[] } {
    if (entries.length <= 1) return { entries, droppedDomains: [] };

    const anchorVendor = vendorOf(entries[0].link);
    const kept: RssEntry[] = [];
    const droppedDomains: string[] = [];
    for (const entry of entries) {
      if (vendorOf(entry.link) === anchorVendor) {
        kept.push(entry);
      } else {
        droppedDomains.push(entry.link);
      }
    }

    // The anchor entry must always survive.
    return { entries: kept.length > 0 ? kept : [entries[0]], droppedDomains };
  }
}
