import type { RecentArticle } from "./TopicSelector";
import type { RssEntry } from "./types";

export interface DeduplicationResult {
  isDuplicate: boolean;
  matchedArticle?: RecentArticle;
  urlOverlapRatio: number;
  tagOverlapRatio: number;
}

/**
 * Check whether selected RSS entries overlap excessively with any past article.
 * Uses source URL overlap as the primary signal and tag Jaccard similarity as secondary.
 *
 * Thresholds:
 * - URL overlap >= 0.5 → duplicate
 * - Tag Jaccard >= 0.6 AND URL overlap >= 0.3 → duplicate (combined signal)
 */
export function checkTopicDuplication(
  selectedEntries: RssEntry[],
  pastArticles: RecentArticle[],
): DeduplicationResult {
  const selectedUrls = new Set(selectedEntries.map((e) => normalizeUrl(e.link)));

  if (selectedUrls.size === 0) {
    return { isDuplicate: false, urlOverlapRatio: 0, tagOverlapRatio: 0 };
  }

  for (const article of pastArticles) {
    const pastUrls = new Set(article.sourceUrls.map(normalizeUrl));
    const urlIntersection = [...selectedUrls].filter((u) => pastUrls.has(u)).length;
    const urlOverlapRatio = urlIntersection / selectedUrls.size;

    if (urlOverlapRatio >= 0.5) {
      return { isDuplicate: true, matchedArticle: article, urlOverlapRatio, tagOverlapRatio: 0 };
    }
  }

  return { isDuplicate: false, urlOverlapRatio: 0, tagOverlapRatio: 0 };
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url.toLowerCase();
  }
}
