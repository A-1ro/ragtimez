import type { CitationIntegrityReport, ICitationIntegrityChecker } from "./interfaces";

const JA_FALLBACK_CITATION = "（出典: 公式ドキュメントに記載なし）";
const EN_FALLBACK_CITATION = "(Source: not detailed in official documentation)";

const JA_REAL_CITATION = /（出典:\s*\[[^\]]*\]\([^)\s]+\)）/;
const EN_REAL_CITATION = /\(Source:\s*\[[^\]]*\]\([^)\s]+\)\)/;

const JA_SUMMARY_HEADINGS = ["まとめ", "Summary"];
const EN_SUMMARY_HEADINGS = ["Summary"];

/**
 * Reports how many non-summary ## sections in a generated article body ended up
 * without a real, verifiable source citation — i.e. PostProcessor.stripFabricatedCitations
 * replaced their citation with the "not documented" placeholder, or the model never
 * produced a citation for that section at all.
 *
 * A high ratio here means the section's PROSE (not just its citation link) is likely
 * ungrounded: DraftGenerator's prompt asks the model to build each section from a
 * specific [Source] block and cite it, so a section with no valid citation was written
 * from something other than the provided sources.
 *
 * This is observability only — it does not alter the article, gate publication, or
 * change control flow. It exists so a fabricated-content pattern that visually looks
 * fine (well-formatted Markdown, plausible prose) shows up in logs instead of only in
 * a human re-reading the published article.
 */
export class CitationIntegrityChecker implements ICitationIntegrityChecker {
  analyze(body: string, lang: "ja" | "en"): CitationIntegrityReport {
    const summaryHeadings = lang === "ja" ? JA_SUMMARY_HEADINGS : EN_SUMMARY_HEADINGS;
    const fallbackText = lang === "ja" ? JA_FALLBACK_CITATION : EN_FALLBACK_CITATION;
    const realCitationPattern = lang === "ja" ? JA_REAL_CITATION : EN_REAL_CITATION;

    // Mask fenced code blocks before splitting on "## " so a code sample that itself
    // contains a line starting with "##" (a shell/YAML comment, or a Markdown example)
    // can't be mistaken for a section boundary.
    const masked = body.replace(/```[\s\S]*?```/g, (block) => block.replace(/^##/gm, "//"));
    const sections = masked.split(/^##\s+/m).slice(1);
    const unsourcedSectionTitles: string[] = [];
    let totalSections = 0;

    for (const section of sections) {
      const title = section.split("\n", 1)[0]?.trim() ?? "";
      if (summaryHeadings.some((heading) => title.startsWith(heading))) continue;

      totalSections++;
      const hasRealCitation = realCitationPattern.test(section);
      const hasFallback = section.includes(fallbackText);
      if (!hasRealCitation || hasFallback) {
        unsourcedSectionTitles.push(title);
      }
    }

    const unsourcedSections = unsourcedSectionTitles.length;
    return {
      totalSections,
      unsourcedSections,
      unsourcedRatio: totalSections > 0 ? unsourcedSections / totalSections : 0,
      unsourcedSectionTitles,
    };
  }
}
