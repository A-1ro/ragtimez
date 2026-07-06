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
 * do not appear in any provided [Source] block. This function finds all Markdown
 * citation blocks in the two expected formats, handles multi-URL citation blocks
 * (e.g. 「（出典: [A](url1)、[B](url2)）」), and replaces any URL not in
 * `allowedUrls` with a placeholder. If a citation block contains a mix of
 * allowed and fabricated URLs, the allowed links are preserved and the fabricated
 * ones are removed individually.
 *
 * Handled formats (single and multiple URLs per block):
 *   Japanese — （出典: [title](url)） or （出典: [A](url1)、[B](url2)）
 *   English  — (Source: [title](url)) or (Source: [A](url1), [B](url2))
 */
export function stripFabricatedCitations(
  body: string,
  allowedUrls: Set<string>,
): string {
  const normalizedAllowed = new Set([...allowedUrls].map(normalizeForComparison));
  let stripped = body;
  let count = 0;

  const isAllowed = (url: string) => normalizedAllowed.has(normalizeForComparison(url));

  /**
   * Given the inner content of a citation block, extract each [title](url) pair,
   * keep only those whose URL is allowed, and report fabricated ones.
   */
  function filterCitationLinks(
    inner: string,
    onFabricated: (url: string) => void,
  ): { allowedLinks: string[]; hadFabricated: boolean } {
    const allowedLinks: string[] = [];
    let hadFabricated = false;
    const linkRe = /\[([^\]]*)\]\(([^)\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(inner)) !== null) {
      const url = m[2];
      if (isAllowed(url)) {
        allowedLinks.push(m[0]);
      } else {
        hadFabricated = true;
        count++;
        onFabricated(url);
      }
    }
    return { allowedLinks, hadFabricated };
  }

  // Japanese citation format: （出典: ... ）
  // Full-width 「）」 is an unambiguous close delimiter that does not appear in URLs or link titles,
  // so [^）]* safely matches the entire inner content including multiple links.
  stripped = stripped.replace(
    /（出典:\s*([^）]*)）/g,
    (match, inner: string) => {
      const { allowedLinks, hadFabricated } = filterCitationLinks(inner, (url) => {
        console.warn(`捏造出典URL削除: ${url.trim()}`);
      });
      if (!hadFabricated) return match;
      return allowedLinks.length > 0
        ? `（出典: ${allowedLinks.join('、')}）`
        : '（出典: 公式ドキュメントに記載なし）';
    },
  );

  // Japanese citation format — bare URL: （出典: https://...）
  // The LLM sometimes ignores Markdown-link instructions and emits bare URLs.
  // These bypass the Markdown-link regex above, so we strip them separately.
  stripped = stripped.replace(
    /（出典:\s*(https?:\/\/[^\s）]+)）/g,
    (match, url: string) => {
      if (!isAllowed(url)) {
        count++;
        console.warn(`捏造出典URL削除（ベアURL）: ${url.trim()}`);
        return "（出典: 公式ドキュメントに記載なし）";
      }
      return match;
    },
  );

  // English citation format: (Source: [title](url), ...) — match one or more Markdown links
  stripped = stripped.replace(
    /\(Source:\s*((?:\[[^\]]*\]\([^)\s]+\)(?:[,、]\s*)?)+)\)/g,
    (match, inner: string) => {
      const { allowedLinks, hadFabricated } = filterCitationLinks(inner, (url) => {
        console.warn(`Fabricated source URL removed: ${url.trim()}`);
      });
      if (!hadFabricated) return match;
      return allowedLinks.length > 0
        ? `(Source: ${allowedLinks.join(', ')})`
        : '(Source: not detailed in official documentation)';
    },
  );

  // English citation format — bare URL: (Source: https://...)
  stripped = stripped.replace(
    /\(Source:\s*(https?:\/\/[^\s)]+)\)/g,
    (match, url: string) => {
      if (!isAllowed(url)) {
        count++;
        console.warn(`Fabricated source URL removed (bare URL): ${url.trim()}`);
        return "(Source: not detailed in official documentation)";
      }
      return match;
    },
  );

  // Strip fabricated inline hyperlinks [text](url) where the URL is not in the allowed set.
  // Negative lookbehind excludes image links ![alt](src).
  // At this point, citation-format links have already been processed (their URLs removed),
  // so remaining [text](url) patterns are inline body links, which are equally subject to
  // the fabrication ban — the LLM must not invent URLs from pre-training knowledge.
  stripped = stripped.replace(
    /(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g,
    (match, text: string, url: string) => {
      if (!isAllowed(url)) {
        count++;
        console.warn(`捏造インラインURL削除: ${url.trim()}`);
        return text;
      }
      return match;
    },
  );

  if (count > 0) {
    console.warn(`合計 ${count} 件の捏造URLを除去しました`);
  }

  return stripped;
}

/**
 * Removes citation blocks from ## まとめ / ## Summary sections.
 *
 * The article generation rules forbid citation lines in the final section, but
 * the LLM occasionally adds them anyway. This function enforces that rule at
 * post-processing time by stripping 「（出典: ...）」 and「(Source: ...)」blocks
 * from within the last (まとめ/Summary) section of the article.
 */
export function removeSummaryCitations(body: string): string {
  const result = body.replace(
    /(##\s*(?:まとめ|Summary)[^\n]*\n)([\s\S]*?)(?=\n##|\s*$)/i,
    (_match, heading: string, content: string) => {
      const cleaned = content
        // Japanese citation blocks (full-width parens are unambiguous delimiters)
        .replace(/（出典:[^）]*）/g, '')
        // English citation blocks
        .replace(/\(Source:\s*(?:\[[^\]]*\]\([^)\s]+\)(?:[,、]\s*)?)*\)/g, '')
        // Collapse triple+ blank lines left by removal
        .replace(/\n{3,}/g, '\n\n');
      if (cleaned !== content) {
        console.warn('## まとめ/Summary セクションから出典ブロックを除去しました');
      }
      return heading + cleaned;
    },
  );
  return result;
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
      const before = result;
      if (row.suggestion !== null) {
        result = result.replace(regex, row.suggestion);
        if (result !== before) {
          console.warn(`禁止フレーズを置換 [${row.severity}]: "${row.pattern}" → "${row.suggestion}"`);
        }
      } else if (regex.test(result)) {
        console.warn(`禁止フレーズ検出 [${row.severity}]: "${row.pattern}"（置換候補なし）`);
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

  // Remove citation blocks from ## まとめ/Summary (rules forbid citations there).
  result = removeSummaryCitations(result);

  // Strip fabricated citations after [N] → URL substitution so that any
  // numeric references resolved to real entry links are included in allowedUrls.
  result = stripFabricatedCitations(result, allowedUrls);

  return result;
}
