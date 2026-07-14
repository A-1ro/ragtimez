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

  // NOTE: fabricated *inline* body links (outside the （出典/Source: ...） templates) are
  // handled separately by stripFabricatedLinks(), which is code-block aware. Keeping that
  // logic out of here avoids mangling `[text](url)` examples inside fenced code blocks.

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

/**
 * Strips fabricated URLs from ordinary inline Markdown links in the article body.
 *
 * stripFabricatedCitations only checks the two fixed "（出典: ...)" / "(Source: ...)"
 * templates. It never inspects other inline links such as "[Guardrails設定ガイド](url)"
 * inside a paragraph, or any link inside the ## まとめ / ## Summary section (which the
 * draft-generation prompt explicitly exempts from citation rules). Those links can carry
 * a plausible-looking but hallucinated documentation URL straight into the published
 * article. This pass checks every remaining Markdown link against `allowedUrls` and, for
 * any URL that isn't one of them, drops the hyperlink but keeps the visible label text so
 * the surrounding sentence still reads naturally.
 */
export function stripFabricatedLinks(body: string, allowedUrls: Set<string>): string {
  const normalizedAllowed = new Set([...allowedUrls].map(normalizeForComparison));
  const isAllowed = (url: string) => normalizedAllowed.has(normalizeForComparison(url));
  let count = 0;

  const segments = body.split(/(```[\s\S]*?```)/g);
  const result = segments
    .map((segment, i) => {
      if (i % 2 === 1) return segment;
      return segment.replace(
        /\[([^\]]*)\]\(\s*<?([^>\s)]+)>?(?:\s[^)]*)?\)/g,
        (match, label: string, url: string) => {
          if (isAllowed(url)) return match;
          count++;
          console.warn(`未許可URLへのインラインリンクを除去: ${url.trim()}`);
          return label;
        },
      );
    })
    .join("");

  if (count > 0) {
    console.warn(`合計 ${count} 件の未許可インラインリンクを除去しました（引用形式以外）`);
  }

  return result;
}

const SUMMARY_HEADINGS = new Set(["## まとめ", "## Summary"]);

/**
 * Logs (does not modify) non-summary "## " sections that end up with zero citation
 * to any allowed URL, once numeric [N] references and fabricated links have already
 * been resolved/stripped. The draft-generation prompt requires every non-summary
 * section to end with a source citation, but nothing previously verified that
 * requirement — a section could omit the citation entirely and publish unnoticed.
 */
function warnMissingSectionCitations(body: string, allowedUrls: Set<string>): void {
  const normalizedAllowed = new Set([...allowedUrls].map(normalizeForComparison));
  const sections = body.split(/\n(?=## )/);
  for (const section of sections) {
    const headingLine = section.split("\n", 1)[0]?.trim() ?? "";
    if (!headingLine.startsWith("## ") || SUMMARY_HEADINGS.has(headingLine)) continue;

    const urls = [...section.matchAll(/\]\(\s*<?([^>\s)]+)>?(?:\s[^)]*)?\)/g)].map((m) => m[1]);
    const hasAllowedUrl = urls.some((url) => normalizedAllowed.has(normalizeForComparison(url)));
    if (!hasAllowedUrl) {
      console.warn(`出典引用のないセクションを検出（要レビュー）: "${headingLine}"`);
    }
  }
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

  // `suggestion` is editorial guidance for a human reviewer (e.g. "主語を明確にし能動態で書く"
  // — "clarify the subject and use active voice"), not replacement text for the matched phrase.
  // It must never be spliced into the article body: doing so previously produced corrupted
  // sentences such as "...適応させること主語を明確にし能動態で書く。" when the banned phrase
  // "ができます" was blindly replaced with its improvement suggestion. Only log it as a warning.
  const banned = await db.prepare(
    "SELECT pattern, severity, suggestion FROM postprocess_banned_phrases"
  ).all<{ pattern: string; severity: string; suggestion: string | null }>();
  for (const row of banned.results) {
    try {
      const regex = new RegExp(row.pattern, "g");
      if (regex.test(result)) {
        console.warn(
          `禁止フレーズ検出 [${row.severity}]: "${row.pattern}"` +
            (row.suggestion ? `（改善提案: ${row.suggestion}）` : "（改善提案なし）"),
        );
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

  // Remove citation blocks from ## まとめ/Summary (rules forbid citations there).
  result = removeSummaryCitations(result);

  // Strip fabricated citations after [N] → URL substitution so that any
  // numeric references resolved to real entry links are included in allowedUrls.
  result = stripFabricatedCitations(result, allowedUrls);
  result = stripFabricatedLinks(result, allowedUrls);
  warnMissingSectionCitations(result, allowedUrls);

  // Strip any lingering citation-format links from まとめ/Summary sections.
  // The prompt forbids citations there; this is a safety net for cases where
  // the LLM includes them anyway (even using a legitimately provided URL).
  result = removeSummaryCitations(result);

  return result;
}
