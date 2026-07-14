import type { ICitationFormatNormalizer } from "./interfaces";

// A citation is already well-formed if it contains at least one proper
// `[text](url)` Markdown link — those are left untouched.
const VALID_LINK_PATTERN = /\[[^\]]*\]\([^)\s]+\)/;
const URL_PATTERN = /https?:\/\/[^\s()]+/;

const JA_MARKER = "（出典:";
const EN_MARKER = "(Source:";

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeLine(line: string, marker: string, lang: "ja" | "en"): string {
  const idx = line.indexOf(marker);
  if (idx === -1) return line;

  const before = line.slice(0, idx);
  const after = line.slice(idx + marker.length);

  // Already uses a real Markdown link — nothing to fix.
  if (VALID_LINK_PATTERN.test(after)) return line;

  const urlMatch = URL_PATTERN.exec(after);
  if (!urlMatch) return line;

  const url = urlMatch[0];
  const label = hostnameOf(url);
  const rebuilt =
    lang === "ja" ? `（出典: [${label}](${url})）` : `(Source: [${label}](${url}))`;

  return `${before}${rebuilt}`;
}

/**
 * See ICitationFormatNormalizer for why this class exists.
 */
export class CitationFormatNormalizer implements ICitationFormatNormalizer {
  normalize(body: string, lang: "ja" | "en"): string {
    const marker = lang === "ja" ? JA_MARKER : EN_MARKER;

    // Skip fenced code blocks so a citation-like string inside an example is never rewritten.
    const segments = body.split(/(```[\s\S]*?```)/g);
    let repaired = 0;

    const result = segments
      .map((segment, i) => {
        if (i % 2 === 1) return segment;
        return segment
          .split("\n")
          .map((line) => {
            if (!line.includes(marker)) return line;
            const rebuilt = normalizeLine(line, marker, lang);
            if (rebuilt !== line) repaired++;
            return rebuilt;
          })
          .join("\n");
      })
      .join("");

    if (repaired > 0) {
      console.warn(`引用フォーマット正規化: 不正な出典表記を ${repaired} 件修復しました`);
    }

    return result;
  }
}
