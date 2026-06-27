import type { RssEntry } from "./types";

/** Normalise a URL for comparison: lowercase hostname, strip trailing slash and fragment. */
function normalizeForComparison(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Strips fabricated citation URLs from the article body.
 *
 * The LLM draft generator sometimes cites URLs from pre-training knowledge that
 * do not appear in any provided [Source] block.  This function finds all
 * Markdown citation links in the two expected formats and replaces those whose
 * URL is not in the `allowedUrls` set with a "not documented" placeholder,
 * preventing hallucinated source links from reaching the published article.
 *
 * Handled formats:
 *   Japanese — （出典: [title](url)）
 *   English  — (Source: [title](url))
 */
export function stripFabricatedCitations(
  body: string,
  allowedUrls: Set<string>,
): string {
  const normalizedAllowed = new Set([...allowedUrls].map(normalizeForComparison));
  let stripped = body;
  let count = 0;

  const isAllowed = (url: string) => normalizedAllowed.has(normalizeForComparison(url));

  // Japanese citation format
  stripped = stripped.replace(
    /（出典:\s*\[[^\]]*\]\(([^)\s]+)\)）/g,
    (match, url: string) => {
      if (!isAllowed(url)) {
        count++;
        console.warn(`捏造出典URL削除: ${url.trim()}`);
        return "（出典: 公式ドキュメントに記載なし）";
      }
      return match;
    },
  );

  // English citation format
  stripped = stripped.replace(
    /\(Source:\s*\[[^\]]*\]\(([^)\s]+)\)\)/g,
    (match, url: string) => {
      if (!isAllowed(url)) {
        count++;
        console.warn(`Fabricated source URL removed: ${url.trim()}`);
        return "(Source: not detailed in official documentation)";
      }
      return match;
    },
  );

  if (count > 0) {
    console.warn(`合計 ${count} 件の捏造出典URLを除去しました`);
  }

  return stripped;
}

export async function postProcess(
  body: string,
  entries: RssEntry[],
  db: D1Database,
  fullTextMap?: Map<string, string>,
): Promise<string> {
  let result = body;

  // Build the set of URLs the LLM was legitimately given as source material.
  // This covers both the core RSS entries and any additional pages fetched by Tavily.
  const allowedUrls = new Set<string>([
    ...entries.map((e) => e.link),
    ...(fullTextMap ? fullTextMap.keys() : []),
  ]);

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

  // Remove empty ## sections: a ## heading immediately followed by another ## heading
  // (with only blank lines between) has no body content and acts as a spurious title.
  // This is a safety net for the DraftGenerator prompt rule that forbids empty sections.
  result = result.replace(/^## [^\n]+\n+(?=## )/gm, "");

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

  // Strip fabricated citations after [N] → URL substitution so that any
  // numeric references resolved to real entry links are included in allowedUrls.
  result = stripFabricatedCitations(result, allowedUrls);

  return result;
}
