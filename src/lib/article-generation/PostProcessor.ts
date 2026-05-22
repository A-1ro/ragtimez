import type { RssEntry } from "./types";

/**
 * Extracts all citation URLs from （出典: [...](<url>)） patterns in the article body
 * and warns about any that are not present in the provided source entries.
 * Does not mutate the body; callers can act on the returned unknownUrls if needed.
 */
export function detectUnknownCitations(body: string, entries: RssEntry[]): string[] {
  const validUrls = new Set(entries.map((e) => e.link));
  // Match 出典 citation links in the form （出典: [...](url)）
  const citationPattern = /（出典[^）]*\]\(\s*<?([^>\s)]+)>?(?:\s[^)]*)?\)/g;
  const unknownUrls: string[] = [];
  let match;
  while ((match = citationPattern.exec(body)) !== null) {
    const url = match[1];
    if (!validUrls.has(url)) {
      unknownUrls.push(url);
    }
  }
  return unknownUrls;
}

export async function postProcess(
  body: string,
  entries: RssEntry[],
  db: D1Database,
): Promise<string> {
  // Warn about citations to URLs not present in the known source entries.
  // These may originate from secondary links inside Tavily full-text content that the LLM
  // treated as primary sources, or from pre-training knowledge leaking into citations.
  const unknownCitations = detectUnknownCitations(body, entries);
  for (const url of unknownCitations) {
    console.warn(`[PostProcessor] 未知ソースURL検出（frontmatter不整合の可能性）: ${url}`);
  }

  let result = body;

  const katakana = await db.prepare(
    "SELECT wrong_form, correct_form FROM postprocess_katakana"
  ).all<{ wrong_form: string; correct_form: string }>();
  for (const row of katakana.results) {
    result = result.replaceAll(row.wrong_form, row.correct_form);
  }

  const banned = await db.prepare(
    "SELECT pattern, severity, suggestion FROM postprocess_banned_phrases"
  ).all<{ pattern: string; severity: string; suggestion: string | null }>();
  for (const row of banned.results) {
    try {
      const regex = new RegExp(row.pattern, "g");
      if (regex.test(result)) {
        console.warn(`禁止フレーズ検出 [${row.severity}]: "${row.pattern}"${row.suggestion ? ` → ${row.suggestion}` : ""}`);
      }
    } catch (err) {
      console.warn(`禁止フレーズの正規表現が不正です: "${row.pattern}" — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Strip MANDATORY KEY NEW FACTS blocks that the LLM may copy verbatim from the context input.
  // These are prompt instructions, not article content.
  result = result.replace(/\*\*MANDATORY[^*\n]*\*\*\n(?:- [^\n]*\n)*\n?/g, "");

  const segments = result.split(/(```[\s\S]*?```)/g);
  result = segments.map((segment, i) => {
    if (i % 2 === 1) return segment;
    return segment.replace(/\[(\d+)\]/g, (match, num) => {
      const idx = parseInt(num, 10) - 1;
      if (idx >= 0 && idx < entries.length) {
        return entries[idx].link;
      }
      return match;
    });
  }).join("");

  return result;
}
