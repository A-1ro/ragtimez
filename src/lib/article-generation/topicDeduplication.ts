import type { RecentArticle } from "./TopicSelector";
import type { RssEntry } from "./types";

export interface DeduplicationResult {
  isDuplicate: boolean;
  matchedArticle?: RecentArticle;
  urlOverlapRatio: number;
  tagOverlapRatio: number;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "can", "about", "into", "through", "that", "this",
  "these", "it", "its", "not",
]);

/**
 * Extract keywords from a text string for similarity comparison.
 * Splits on whitespace and punctuation, lowercases, removes stop words,
 * and filters out words shorter than 2 characters.
 */
function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().split(/[\s\p{P}]+/u);
  return new Set(words.filter((w) => w.length >= 2 && !STOP_WORDS.has(w)));
}

/**
 * Compute Jaccard similarity between the keywords extracted from a topic text
 * and the keywords extracted from a list of tag strings.
 */
function computeTopicTagSimilarity(topicText: string, tags: string[]): number {
  const topicKeywords = extractKeywords(topicText);
  const tagKeywords = extractKeywords(tags.join(" "));

  const union = new Set([...topicKeywords, ...tagKeywords]);
  if (union.size === 0) return 0;

  const intersection = [...topicKeywords].filter((w) => tagKeywords.has(w)).length;
  return intersection / union.size;
}

/**
 * Check whether selected RSS entries overlap excessively with any past article.
 * Uses source URL overlap as the primary signal and topic-tag keyword Jaccard
 * similarity as a secondary signal.
 *
 * Thresholds:
 * - URL overlap >= 0.5 → duplicate
 * - Topic-tag keyword Jaccard >= 0.6 → duplicate (independent signal)
 * - Topic-tag keyword Jaccard >= 0.4 AND URL overlap >= 0.2 → duplicate (combined signal)
 */
export function checkTopicDuplication(
  selectedEntries: RssEntry[],
  pastArticles: RecentArticle[],
  topicText?: string,
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

    if (topicText && article.tags && article.tags.length > 0) {
      const tagOverlapRatio = computeTopicTagSimilarity(topicText, article.tags);

      // Strong keyword overlap alone is sufficient
      if (tagOverlapRatio >= 0.6) {
        return { isDuplicate: true, matchedArticle: article, urlOverlapRatio, tagOverlapRatio };
      }

      // Moderate keyword overlap combined with some URL overlap is also a duplicate
      if (tagOverlapRatio >= 0.4 && urlOverlapRatio >= 0.2) {
        return { isDuplicate: true, matchedArticle: article, urlOverlapRatio, tagOverlapRatio };
      }
    }
  }

  return { isDuplicate: false, urlOverlapRatio: 0, tagOverlapRatio: 0 };
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url.toLowerCase();
  }
}
