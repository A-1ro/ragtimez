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
 * Repairs a distinct malformed citation artifact the draft LLM occasionally emits:
 * a bare URL immediately followed by a parenthesized second URL instead of proper
 * `[title](url)` Markdown link syntax, e.g. `（出典: https://a/b(https://a/)）`. This
 * shape defeats every downstream regex that expects either a Markdown link or a
 * matching full-width closing paren (citation stripping, Summary-citation removal,
 * cited-source detection for frontmatter), so it must be normalized to a real
 * Markdown link before those passes run. Runs as an additive pass before
 * PostProcessor.postProcess and does not alter any existing post-processing behavior.
 */
export interface ICitationFormatNormalizer {
  normalize(body: string): string;
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
