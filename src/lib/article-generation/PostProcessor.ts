import type { RssEntry } from "./types";

/**
 * Extracts all Markdown citation URLs from the article body and logs warnings
 * for any that don't appear in the provided entries list. This catches cases
 * where the LLM cites off-topic or hallucinated sources.
 */
function validateCitationUrls(body: string, entries: RssEntry[]): void {
  const entryUrls = new Set(entries.map((e) => e.link));
  // Match both Japanese （出典: [text](url)） and English (Source: [text](url)) citation patterns
  const citationPattern = /\((?:出典|Source):\s*\[.*?\]\((https?:\/\/[^)]+)\)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = citationPattern.exec(body)) !== null) {
    const citedUrl = match[1];
    if (!entryUrls.has(citedUrl)) {
      console.warn(
        `[PostProcessor] 引用URLがソースリストに存在しません（オフトピックまたは捏造の可能性）: ${citedUrl}`,
      );
    }
  }
}

export async function postProcess(
  body: string,
  entries: RssEntry[],
  db: D1Database,
): Promise<string> {
  let result = body;

  validateCitationUrls(body, entries);

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
