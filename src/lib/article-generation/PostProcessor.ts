import type { RssEntry } from "./types";

export async function postProcess(
  body: string,
  entries: RssEntry[],
  db: D1Database,
): Promise<string> {
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
