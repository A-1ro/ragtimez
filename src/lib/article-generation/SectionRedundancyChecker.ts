import type { ISectionRedundancyChecker, SectionRedundancyReport } from "./interfaces";

const JA_SUMMARY_HEADINGS = ["まとめ", "Summary"];
const EN_SUMMARY_HEADINGS = ["Summary"];

// Minimum sentence length (in characters, after normalization) considered for comparison.
// Shorter sentences ("それは重要です。" / "This matters.") produce noisy false positives.
const MIN_SENTENCE_LENGTH = 12;
// Minimum longest-common-substring length (characters) to consider as a real overlap.
// Below this, short connective phrases ("することができます") can coincide by chance.
const MIN_LCS_LENGTH = 14;
// The shared substring must cover at least this fraction of the shorter sentence.
// Paraphrased duplicates (same clause, reworded lead-in) typically retain a long
// verbatim tail or head even when the rest of the sentence differs, so this catches
// partial verbatim repeats that a whole-sentence similarity score would miss.
const LCS_COVERAGE_THRESHOLD = 0.35;

/**
 * Strips citation blocks and Markdown links before sentence splitting. This must run on
 * the whole section content, not per-sentence: the naive sentence splitter treats "." as
 * a boundary, so a URL (e.g. "...gpt-5-6-sol...", "aws.amazon.com") inside a still-present
 * citation would otherwise be sliced into spurious one-word "sentences" that never carry
 * enough content to compare meaningfully.
 */
function stripCitationsAndLinks(content: string): string {
  return content
    // Resolve the nested-link artifact FactualIntegrityValidator also targets
    // (`[label]([inner](url))`) before the general link-stripping pass below, since the
    // general pass's non-nesting-aware regex stops at the first ")" and leaves a mangled
    // remainder that would otherwise masquerade as a spurious cross-section duplicate.
    .replace(/\[([^\[\]]+)\]\(\[[^\[\]]*\]\(([^()\s]+)\)\)/g, "$1")
    .replace(/（出典:[^）]*）/g, "")
    .replace(/\(Source:[^)]*\)/gi, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

function normalizeSentence(sentence: string): string {
  return sentence
    .replace(/[\s　、。,.!?！？「」『』【】\-—・:：;；()（）]/g, "")
    .toLowerCase();
}

/**
 * Length of the longest contiguous substring shared by both strings, via the classic
 * O(n*m) dynamic-programming scan (rolling one row of state, no full matrix needed).
 */
function longestCommonSubstringLength(a: string, b: string): number {
  const prevRow = new Array(b.length + 1).fill(0);
  let max = 0;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const current = prevRow[j];
      if (a[i - 1] === b[j - 1]) {
        prevRow[j] = diagonal + 1;
        if (prevRow[j] > max) max = prevRow[j];
      } else {
        prevRow[j] = 0;
      }
      diagonal = current;
    }
  }
  return max;
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[。．.!?！？])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface SectionInfo {
  title: string;
  sentences: string[];
}

/**
 * Detects near-duplicate sentences that appear in more than one non-summary ## section
 * of a generated article body.
 *
 * DraftGenerator's prompt already instructs the model not to repeat the same information
 * across sections, but this rule is instruction-following only — nothing previously verified
 * it. This checker is a deterministic, language-agnostic safety net (longest-common-substring
 * coverage, so it needs no JA/EN-specific tokenizer) that flags violations for observability.
 * It catches partially-paraphrased duplicates (same clause, reworded lead-in) that a
 * whole-sentence similarity score would under-detect, since such paraphrases typically keep
 * one long verbatim fragment even when the rest of the sentence is reworded.
 *
 * Mirrors CitationIntegrityChecker: read-only, does not alter the article body, gate
 * publication, or change control flow. It exists so cross-section repetition shows up in
 * logs instead of only in a human re-reading the published article.
 */
export class SectionRedundancyChecker implements ISectionRedundancyChecker {
  analyze(body: string, lang: "ja" | "en"): SectionRedundancyReport {
    const summaryHeadings = lang === "ja" ? JA_SUMMARY_HEADINGS : EN_SUMMARY_HEADINGS;

    // Mask fenced code blocks before splitting on "## " so code samples containing
    // "##"-prefixed lines (shell/YAML comments) aren't mistaken for section boundaries.
    const masked = body.replace(/```[\s\S]*?```/g, (block) => block.replace(/^##/gm, "//"));
    const rawSections = masked.split(/^##\s+/m).slice(1);

    const sections: SectionInfo[] = [];
    for (const section of rawSections) {
      const lines = section.split("\n");
      const title = lines[0]?.trim() ?? "";
      if (summaryHeadings.some((heading) => title.startsWith(heading))) continue;
      const content = stripCitationsAndLinks(lines.slice(1).join("\n"));
      sections.push({ title, sentences: splitIntoSentences(content) });
    }

    const duplicatePairs: SectionRedundancyReport["duplicatePairs"] = [];

    for (let i = 0; i < sections.length; i++) {
      for (let j = i + 1; j < sections.length; j++) {
        for (const sentenceA of sections[i].sentences) {
          const normA = normalizeSentence(sentenceA);
          if (normA.length < MIN_SENTENCE_LENGTH) continue;

          for (const sentenceB of sections[j].sentences) {
            const normB = normalizeSentence(sentenceB);
            if (normB.length < MIN_SENTENCE_LENGTH) continue;

            const lcsLength = longestCommonSubstringLength(normA, normB);
            const coverage = lcsLength / Math.min(normA.length, normB.length);
            if (lcsLength >= MIN_LCS_LENGTH && coverage >= LCS_COVERAGE_THRESHOLD) {
              duplicatePairs.push({
                sectionA: sections[i].title,
                sectionB: sections[j].title,
                sentenceA: sentenceA.trim(),
                sentenceB: sentenceB.trim(),
                similarity: coverage,
              });
            }
          }
        }
      }
    }

    return {
      totalSections: sections.length,
      duplicatePairs,
    };
  }
}
