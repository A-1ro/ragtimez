import type { CollectionEntry } from "astro:content";

export type ArticleEntry = CollectionEntry<"articles">;

export interface SearchOptions {
  query: string;
  lang: "ja" | "en";
  tag?: string;
}

export interface SearchHit {
  entry: ArticleEntry;
  titleHtml: string;
  summaryHtml: string;
  matchedInBody: boolean;
}

export function normalizeQuery(q: string): string {
  const trimmed = q.trim();
  if (!trimmed) return "";
  return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function highlight(text: string, query: string): string {
  if (!query) return escapeHtml(text);

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  if (!queryLower) return escapeHtml(text);

  // Walk the plain text and find matches via indexOf, then assemble the output
  // by escaping each segment individually. Doing the match on plain text (not
  // on the escaped string) avoids accidentally matching inside HTML entities
  // such as &amp; when the query happens to contain "amp"/"lt"/"gt".
  const parts: string[] = [];
  let cursor = 0;
  const matchLen = queryLower.length;

  while (cursor <= text.length) {
    const idx = textLower.indexOf(queryLower, cursor);
    if (idx === -1) {
      parts.push(escapeHtml(text.slice(cursor)));
      break;
    }
    if (idx > cursor) {
      parts.push(escapeHtml(text.slice(cursor, idx)));
    }
    parts.push(`<mark>${escapeHtml(text.slice(idx, idx + matchLen))}</mark>`);
    cursor = idx + matchLen;
  }

  return parts.join("");
}

export function searchArticles(
  articles: ArticleEntry[],
  options: SearchOptions,
): SearchHit[] {
  const { query, lang, tag } = options;
  const normalizedQ = normalizeQuery(query);
  if (!normalizedQ) return [];

  const qLower = normalizedQ.toLowerCase();

  const filtered = articles.filter((entry) => {
    if (entry.data.lang !== lang) return false;
    if (entry.data.draft) return false;
    if (tag && !entry.data.tags.includes(tag)) return false;
    return true;
  });

  const hits: SearchHit[] = [];

  for (const entry of filtered) {
    const title = entry.data.title ?? "";
    const summary = entry.data.summary ?? "";
    const tagsText = entry.data.tags.join(" ");
    const body = entry.body ?? "";

    const titleLower = title.toLowerCase();
    const summaryLower = summary.toLowerCase();
    const tagsLower = tagsText.toLowerCase();
    const bodyLower = body.toLowerCase();

    const matchedTitle = titleLower.includes(qLower);
    const matchedSummary = summaryLower.includes(qLower);
    const matchedTags = tagsLower.includes(qLower);
    const matchedBody = bodyLower.includes(qLower);

    if (!matchedTitle && !matchedSummary && !matchedTags && !matchedBody) {
      continue;
    }

    const matchedInBody =
      !matchedTitle && !matchedSummary && !matchedTags && matchedBody;

    hits.push({
      entry,
      titleHtml: highlight(title, normalizedQ),
      summaryHtml: highlight(summary, normalizedQ),
      matchedInBody,
    });
  }

  hits.sort(
    (a, b) => b.entry.data.date.getTime() - a.entry.data.date.getTime(),
  );

  return hits;
}
