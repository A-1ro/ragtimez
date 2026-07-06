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

export interface ITranslationService {
  parseArticleMarkdown(raw: string): TranslationSource | null;
  resolveTranslationSource(input: {
    date: string;
    lang: "ja" | "en";
    jaArticleContent?: string;
  }): Promise<TranslationSource | null>;
  translateArticle(source: TranslationSource, date: string): Promise<TranslationResult>;
}
