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
 * Promotes `###`+ headings to `##`.
 *
 * The DraftGenerator prompt forbids `###` anywhere in the article body —
 * nesting sub-sections under one `##` wrapper produces a single bloated
 * section instead of the intended flat `## A` -> `## B` -> ... -> `##
 * まとめ/Summary` structure, and silently breaks every other
 * section-boundary-based check downstream (CitationIntegrityChecker,
 * ICitationPlacementNormalizer), since they all split on `## ` boundaries.
 * Mechanical, deterministic — never judges content, only heading level, and
 * never touches fenced code blocks.
 */
export interface IHeadingLevelNormalizer {
  normalize(body: string): string;
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
