import type { RssEntry } from "./types";
import type { RecentArticle, TopicSelection } from "./TopicSelector";
import type { TavilyUsageBudget } from "./ResearchEnricher";
import type {
  TranslationResult,
  TranslationSource,
} from "./TranslationService";

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
    tavilyBudget: TavilyUsageBudget;
  }): Promise<{ contextEntries: RssEntry[]; fullTextMap?: Map<string, string> }>;
  enrichSelectedTopic(input: {
    topic: string;
    selectedEntries: RssEntry[];
    fullTextMap?: Map<string, string>;
    tavilyBudget: TavilyUsageBudget;
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
    context: string;
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
