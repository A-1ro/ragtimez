import type { RssEntry } from "./types";
import type { RecentArticle, TopicSelection } from "./TopicSelector";
import type {
  TranslationResult,
  TranslationSource,
} from "./TranslationService";

export interface SearchUsageBudget {
  searchCalls: number;
  extractUrls: number;
}

export interface ITopicSelector {
  select(input: {
    entries: RssEntry[];
    pastArticles: RecentArticle[];
    rejectedTopics: string[];
    hasFullTextInitial: boolean;
  }): Promise<{ topicSelection: TopicSelection; selectedEntries: RssEntry[] }>;
}

/**
 * Deterministic (non-LLM) post-filter applied to a topic's selected entries.
 * Exists as a code-level safety net alongside the LLM-based relevance audit,
 * whose instruction-following is probabilistic and has repeatedly let
 * cross-vendor entries survive into "one topic deep-dive" articles.
 */
export interface IEntryRelevanceFilter {
  filter(entries: RssEntry[]): { entries: RssEntry[]; droppedDomains: string[] };
}

export interface IResearchEnricher {
  buildInitialResearch(input: {
    entries: RssEntry[];
    date: string;
    searchBudget: SearchUsageBudget;
  }): Promise<{ contextEntries: RssEntry[]; fullTextMap?: Map<string, string> }>;
  enrichSelectedTopic(input: {
    topic: string;
    selectedEntries: RssEntry[];
    fullTextMap?: Map<string, string>;
    searchBudget: SearchUsageBudget;
    attempt: number;
  }): Promise<{ selectedEntries: RssEntry[]; fullTextMap?: Map<string, string> }>;
  evaluateSourceQuality(
    selectedEntries: RssEntry[],
    fullTextMap: Map<string, string> | undefined,
  ): { score: number; details: { fullTextCount: number; officialCount: number; totalChars: number } };
  buildContext(entries: RssEntry[], fullTextMap?: Map<string, string>): string;
}

export interface IMetadataGenerator {
  generate(input: {
    draftBody: string;
    lang: "ja" | "en";
  }): Promise<{ title: string; summary: string; tags: string[] }>;
}

export interface IDraftGenerator {
  generate(input: {
    contextBlock: string;
    lang: "ja" | "en";
    hasFullText: boolean;
  }): Promise<string>;
}

export interface CitationIntegrityReport {
  totalSections: number;
  unsourcedSections: number;
  unsourcedRatio: number;
  unsourcedSectionTitles: string[];
}

export interface ICitationIntegrityChecker {
  analyze(body: string, lang: "ja" | "en"): CitationIntegrityReport;
}

export interface ITranslationService {
  parseArticleMarkdown(raw: string): TranslationSource | null;
  resolveTranslationSource(input: {
    date: string;
    lang: "ja" | "en";
    jaArticleContent?: string;
  }): Promise<TranslationSource | null>;
  translateArticle(source: TranslationSource, date: string): Promise<TranslationResult>;
}

/**
 * Repairs structural Markdown artifacts the draft LLM occasionally emits
 * (e.g. a link whose href is itself an unresolved `[label](url)` pair).
 * Runs as an additive pass after PostProcessor.postProcess and does not
 * alter any existing post-processing behavior.
 */
export interface IFactualIntegrityValidator {
  validate(body: string): string;
}

/**
 * Rewrites malformed citation markers — e.g. a bare URL immediately followed
 * by a second, unbracketed parenthesized URL such as
 * `（出典: https://a.com/page(https://a.com/)）` — into the canonical
 * `（出典: [title](url)）` / `(Source: [title](url))` Markdown-link form.
 *
 * PostProcessor.stripFabricatedCitations, PostProcessor.removeSummaryCitations,
 * and sourceMetadata.filterSourcesByCited all require a `[text](url)` link to
 * detect and validate a citation. When the draft LLM emits a bare-URL citation
 * instead, those existing safety nets silently pass it through unexamined —
 * so a fabricated or off-topic URL can survive into ## Summary / frontmatter
 * sources undetected. This runs as an additive pass BEFORE PostProcessor.postProcess
 * so those existing checks keep working unmodified; citations that are already
 * well-formed are left untouched.
 */
export interface ICitationFormatNormalizer {
  normalize(body: string, lang: "ja" | "en"): string;
}

/**
 * Repairs the "## wrapper containing ### sub-sections" structure the draft
 * LLM occasionally emits despite the prompt's flat-heading requirement.
 * Runs as an additive pass, independent of PostProcessor.postProcess and
 * IFactualIntegrityValidator, and does not alter any existing behavior for
 * articles that already use a flat ## structure.
 */
export interface IHeadingStructureValidator {
  validate(body: string): string;
}

/**
 * Deterministically enforces two DraftGenerator citation rules that the
 * generation prompt already states but the model does not reliably follow:
 *  1. The section-end citation must appear at the END of a section, not
 *     immediately below the heading.
 *  2. When the same source URL is cited by 3+ non-summary sections, the
 *     2nd and later occurrences must be abbreviated to a "see above" form
 *     instead of repeating the full citation.
 * Purely structural — does not judge or alter factual content, and never
 * touches the ## まとめ / ## Summary section.
 */
export interface ICitationPlacementNormalizer {
  normalize(body: string, lang: "ja" | "en"): string;
}

export interface SectionRedundancyReport {
  totalSections: number;
  duplicatePairs: Array<{
    sectionA: string;
    sectionB: string;
    sentenceA: string;
    sentenceB: string;
    similarity: number;
  }>;
}

/**
 * Detects near-duplicate sentences repeated across non-summary ## sections.
 * Observability only — mirrors ICitationIntegrityChecker: does not alter the
 * article body, gate publication, or change control flow.
 */
export interface ISectionRedundancyChecker {
  analyze(body: string, lang: "ja" | "en"): SectionRedundancyReport;
}
