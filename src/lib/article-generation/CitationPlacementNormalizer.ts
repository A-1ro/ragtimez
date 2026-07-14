import type { ICitationPlacementNormalizer } from "./interfaces";

const JA_SUMMARY_HEADINGS = ["まとめ", "Summary"];
const EN_SUMMARY_HEADINGS = ["Summary"];

// Matches a citation line built from one or more Markdown-linked citations,
// e.g. （出典: [a.com](url)） or （出典: [a.com](url1)、[b.com](url2)）.
const JA_CITATION_LINE = /^（出典:\s*(?:\[[^\]]*\]\([^)\s]+\)(?:[,、]\s*)?)+）[ \t]*$/;
const EN_CITATION_LINE = /^\(Source:\s*(?:\[[^\]]*\]\([^)\s]+\)(?:[,、]\s*)?)+\)[ \t]*$/;

// Matches a citation line with exactly ONE Markdown link — the only shape
// eligible for "see above" abbreviation (a multi-source line stays as-is).
const JA_SINGLE_CITATION = /^（出典:\s*\[([^\]]*)\]\(([^)\s]+)\)）[ \t]*$/;
const EN_SINGLE_CITATION = /^\(Source:\s*\[([^\]]*)\]\(([^)\s]+)\)\)[ \t]*$/;

function isSummaryTitle(title: string, lang: "ja" | "en"): boolean {
  const headings = lang === "ja" ? JA_SUMMARY_HEADINGS : EN_SUMMARY_HEADINGS;
  return headings.some((h) => title.startsWith(h));
}

export class CitationPlacementNormalizer implements ICitationPlacementNormalizer {
  normalize(body: string, lang: "ja" | "en"): string {
    const repositioned = this.repositionCitations(body, lang);
    return this.deduplicateRepeatedCitations(repositioned, lang);
  }

  /**
   * Moves a citation line that immediately follows a ## heading (before any
   * prose) down to the end of that section, matching the DraftGenerator
   * prompt's "cite at the end of the section" rule.
   */
  private repositionCitations(body: string, lang: "ja" | "en"): string {
    const citationLineRe = lang === "ja" ? JA_CITATION_LINE : EN_CITATION_LINE;

    const parts = body.split(/\n(?=## )/);
    const rewritten = parts.map((part) => {
      const lines = part.split("\n");
      const headingLine = lines[0]?.trim() ?? "";
      if (!headingLine.startsWith("## ")) return part;
      const title = headingLine.slice(3).trim();
      if (isSummaryTitle(title, lang)) return part;

      // Only look at the first non-blank line after the heading.
      let cursor = 1;
      while (cursor < lines.length && lines[cursor].trim() === "") cursor++;
      if (cursor >= lines.length || !citationLineRe.test(lines[cursor].trim())) return part;

      const citationLine = lines[cursor];
      const remaining = [...lines.slice(0, cursor), ...lines.slice(cursor + 1)];
      while (remaining.length > 0 && remaining[remaining.length - 1].trim() === "") {
        remaining.pop();
      }
      // The split below consumes the "\n" immediately before the next "## " heading, and
      // .join("\n") reinserts exactly one — so an extra blank line is needed here to keep
      // the citation visually separated from the section that follows it.
      return [...remaining, "", citationLine, ""].join("\n");
    });

    return rewritten.join("\n");
  }

  /**
   * When the same source URL is cited (as a single-link citation line) by
   * 3 or more non-summary sections, abbreviates the 2nd and later
   * occurrences to a "see above" form, per the DraftGenerator prompt's
   * citation-deduplication rule.
   */
  private deduplicateRepeatedCitations(body: string, lang: "ja" | "en"): string {
    const singleCitationRe = lang === "ja" ? JA_SINGLE_CITATION : EN_SINGLE_CITATION;

    const parts = body.split(/\n(?=## )/);
    const matches: Array<{ title: string; url: string; lineIdx: number } | null> = parts.map(
      (part) => {
        const lines = part.split("\n");
        const headingLine = lines[0]?.trim() ?? "";
        if (!headingLine.startsWith("## ")) return null;
        const title = headingLine.slice(3).trim();
        if (isSummaryTitle(title, lang)) return null;

        let lastNonBlank = lines.length - 1;
        while (lastNonBlank > 0 && lines[lastNonBlank].trim() === "") lastNonBlank--;
        const m = singleCitationRe.exec(lines[lastNonBlank].trim());
        if (!m) return null;
        return { title: m[1], url: m[2], lineIdx: lastNonBlank };
      },
    );

    const urlCounts = new Map<string, number>();
    for (const m of matches) {
      if (m) urlCounts.set(m.url, (urlCounts.get(m.url) ?? 0) + 1);
    }

    const seenSoFar = new Map<string, number>();
    const rewritten = parts.map((part, i) => {
      const match = matches[i];
      if (!match) return part;
      const total = urlCounts.get(match.url) ?? 0;
      const occurrence = (seenSoFar.get(match.url) ?? 0) + 1;
      seenSoFar.set(match.url, occurrence);
      if (total < 3 || occurrence === 1) return part;

      const abbreviated =
        lang === "ja" ? `（出典: 前出 [${match.title}]）` : `(Source: see above — [${match.title}])`;
      const lines = part.split("\n");
      lines[match.lineIdx] = abbreviated;
      return lines.join("\n");
    });

    return rewritten.join("\n");
  }
}
