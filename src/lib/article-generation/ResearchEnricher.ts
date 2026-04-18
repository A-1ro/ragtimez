import {
  MAX_CONTEXT_ENTRIES,
  MAX_TITLE_LENGTH,
  MAX_SUMMARY_LENGTH,
  SOURCE_QUALITY_MAX_RETRIES,
  SOURCE_QUALITY_THRESHOLD,
  TAVILY_CONTENT_MAX_CHARS,
  TAVILY_CONTEXT_MAX_TOTAL_CHARS,
  TAVILY_EXTRACT_MAX_URLS,
  TAVILY_MAX_EXTRACT_URLS_TOTAL,
  TAVILY_MAX_SEARCH_CALLS,
} from "./constants";
import type { IResearchEnricher, SearchUsageBudget } from "./interfaces";
import { OFFICIAL_DOMAINS, classifySourceType } from "./sourceMetadata";
import { sanitizeExternalContent } from "./textUtils";
import type { RssEntry } from "./types";
import type { ExtractResult, ISearchProvider, SearchResult } from "../search/interfaces";

export interface TopicAttempt {
  topicSelection: { topic: string; reason: string; indices: number[] };
  selectedEntries: RssEntry[];
  fullTextMap: Map<string, string> | undefined;
  score: number;
}

export class ResearchEnricher implements IResearchEnricher {
  constructor(private readonly searchProvider?: ISearchProvider) {}

  async buildInitialResearch(input: {
    entries: RssEntry[];
    date: string;
    searchBudget: SearchUsageBudget;
  }): Promise<{ contextEntries: RssEntry[]; fullTextMap?: Map<string, string> }> {
    let contextEntries = input.entries.slice(0, MAX_CONTEXT_ENTRIES);
    let fullTextMap: Map<string, string> | undefined;

    if (!this.searchProvider) {
      return { contextEntries, fullTextMap };
    }

    try {
      const queries = this.buildTavilyQueries(contextEntries, input.date);
      console.log(`Tavily search: ${queries.length} queries`);

      const searchResults = await this.searchProvider.search(queries);
      input.searchBudget.searchCalls += queries.length;
      console.log(`Tavily search returned ${searchResults.length} results`);

      contextEntries = this.mergeWithTavilyResults(contextEntries, searchResults).slice(
        0,
        MAX_CONTEXT_ENTRIES,
      );

      const allUrls = contextEntries.map((entry) => entry.link);
      const officialUrls = allUrls.filter((url) => classifySourceType(url) === "official");
      const nonOfficialUrls = allUrls.filter((url) => classifySourceType(url) !== "official");
      const extractBudgetRemaining =
        TAVILY_MAX_EXTRACT_URLS_TOTAL - input.searchBudget.extractUrls;
      const extractUrls = [...officialUrls, ...nonOfficialUrls].slice(
        0,
        Math.min(TAVILY_EXTRACT_MAX_URLS, extractBudgetRemaining),
      );

      console.log(`Tavily extract: ${extractUrls.length} URLs`);
      const extractResults = await this.searchProvider.extract(extractUrls);
      input.searchBudget.extractUrls += extractUrls.length;
      console.log(`Tavily extract returned ${extractResults.length} results`);

      if (extractResults.length > 0) {
        fullTextMap = this.buildFullTextMap(extractResults, new Set(officialUrls));
        console.log(`Full text map: ${fullTextMap.size} entries`);
      }
    } catch (err) {
      console.warn(
        `Tavily RAG pipeline failed, falling back to RSS summaries only: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { contextEntries, fullTextMap };
  }

  async enrichSelectedTopic(input: {
    topic: string;
    selectedEntries: RssEntry[];
    fullTextMap?: Map<string, string>;
    searchBudget: SearchUsageBudget;
    attempt: number;
  }): Promise<{ selectedEntries: RssEntry[]; fullTextMap?: Map<string, string> }> {
    let selectedEntries = input.selectedEntries;
    let currentFullTextMap = input.fullTextMap ? new Map(input.fullTextMap) : undefined;

    if (!this.searchProvider || !input.topic) {
      return { selectedEntries, fullTextMap: currentFullTextMap };
    }

    const searchBudgetRemaining = TAVILY_MAX_SEARCH_CALLS - input.searchBudget.searchCalls;
    if (searchBudgetRemaining <= 0) {
      console.log(
        `Tavily 追加検索スキップ（予算上限到達: searchCalls=${input.searchBudget.searchCalls}/${TAVILY_MAX_SEARCH_CALLS}）`,
      );
      return { selectedEntries, fullTextMap: currentFullTextMap };
    }

    try {
      const topicText = sanitizeExternalContent(input.topic).slice(0, MAX_TITLE_LENGTH);
      const docQuery = `${topicText} documentation tutorial API`;
      console.log(
        `Tavily 公式ドキュメント検索（試行 ${input.attempt + 1}/${SOURCE_QUALITY_MAX_RETRIES + 1}）: "${docQuery.slice(0, 200)}"`,
      );

      const entryDomains = new Set<string>();
      for (const entry of selectedEntries) {
        try {
          const hostname = new URL(entry.link).hostname.replace(/^www\./, "");
          for (const domain of OFFICIAL_DOMAINS) {
            if (hostname === domain || hostname.endsWith(`.${domain}`)) {
              entryDomains.add(domain);
            }
          }
        } catch {}
      }

      const hasOfficialDomains = entryDomains.size > 0;
      const searchOptions = hasOfficialDomains
        ? { search_depth: "advanced" as const, include_domains: [...entryDomains] }
        : { search_depth: "advanced" as const };

      console.log(
        `Tavily search options: depth=advanced, domains=${hasOfficialDomains ? [...entryDomains].join(",") : "(none)"}`,
      );
      const additionalSearchResults = await this.searchProvider.search([docQuery], searchOptions);
      input.searchBudget.searchCalls += 1;
      console.log(`Tavily 公式ドキュメント検索結果: ${additionalSearchResults.length} 件`);

      if (additionalSearchResults.length === 0) {
        return { selectedEntries, fullTextMap: currentFullTextMap };
      }

      selectedEntries = this.mergeWithTavilyResults(selectedEntries, additionalSearchResults).slice(
        0,
        MAX_CONTEXT_ENTRIES,
      );

      const extractBudgetRemaining =
        TAVILY_MAX_EXTRACT_URLS_TOTAL - input.searchBudget.extractUrls;
      if (extractBudgetRemaining <= 0) {
        console.log(
          `Tavily 追加 extract スキップ（予算上限到達: extractUrls=${input.searchBudget.extractUrls}/${TAVILY_MAX_EXTRACT_URLS_TOTAL}）`,
        );
        return { selectedEntries, fullTextMap: currentFullTextMap };
      }

      const additionalUrls = additionalSearchResults
        .slice(0, Math.min(3, extractBudgetRemaining))
        .map((result) => result.url);
      console.log(`Tavily 追加 extract: ${additionalUrls.length} URLs`);
      const additionalExtractResults = await this.searchProvider.extract(additionalUrls);
      input.searchBudget.extractUrls += additionalUrls.length;
      console.log(`Tavily 追加 extract 結果: ${additionalExtractResults.length} 件`);

      if (additionalExtractResults.length === 0) {
        return { selectedEntries, fullTextMap: currentFullTextMap };
      }

      const currentMap = currentFullTextMap ?? new Map<string, string>();
      let totalChars = [...currentMap.values()].reduce((acc, value) => acc + value.length, 0);

      for (const result of additionalExtractResults) {
        if (currentMap.has(result.url)) continue;
        if (totalChars >= TAVILY_CONTEXT_MAX_TOTAL_CHARS) break;
        if (!result.raw_content) continue;

        const remaining = TAVILY_CONTEXT_MAX_TOTAL_CHARS - totalChars;
        const trimmed = sanitizeExternalContent(result.raw_content).slice(
          0,
          Math.min(TAVILY_CONTENT_MAX_CHARS, remaining),
        );
        currentMap.set(result.url, trimmed);
        totalChars += trimmed.length;
      }

      currentFullTextMap = currentMap;
      console.log(`fullTextMap 更新後エントリ数: ${currentFullTextMap.size}`);
      return { selectedEntries, fullTextMap: currentFullTextMap };
    } catch (err) {
      console.warn(
        `Tavily 追加検索失敗（続行）: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { selectedEntries, fullTextMap: currentFullTextMap };
    }
  }

  evaluateSourceQuality(
    selectedEntries: RssEntry[],
    fullTextMap: Map<string, string> | undefined,
  ): { score: number; details: { fullTextCount: number; officialCount: number; totalChars: number } } {
    const fullTextCount = fullTextMap
      ? selectedEntries.filter((entry) => fullTextMap.has(entry.link)).length
      : 0;

    const officialCount = selectedEntries.filter(
      (entry) => classifySourceType(entry.link) === "official",
    ).length;

    let totalChars = 0;
    for (const entry of selectedEntries) {
      const fullText = fullTextMap?.get(entry.link);
      totalChars += fullText ? fullText.length : (entry.summary?.length ?? 0);
    }

    let score = 0;
    if (fullTextCount >= 1) score++;
    if (officialCount >= 1) score++;
    if (totalChars >= 1500) score++;

    return { score, details: { fullTextCount, officialCount, totalChars } };
  }

  buildContext(entries: RssEntry[], fullTextMap?: Map<string, string>): string {
    return entries
      .map((entry, index) => {
        const title = sanitizeExternalContent(entry.title).slice(0, MAX_TITLE_LENGTH);
        const fullText = fullTextMap?.get(entry.link);
        const body = fullText
          ? sanitizeExternalContent(fullText).slice(0, TAVILY_CONTENT_MAX_CHARS)
          : sanitizeExternalContent(entry.summary ? entry.summary.trim() : "(no summary)").slice(
              0,
              MAX_SUMMARY_LENGTH,
            );
        const bodyLabel = fullText ? "Full content (truncated)" : "Summary";
        return `[${index + 1}] Source: ${entry.link}\nTitle: ${title}\n${bodyLabel}: ${body}`;
      })
      .join("\n\n---\n\n");
  }

  private buildTavilyQueries(entries: RssEntry[], date: string): string[] {
    const year = date.slice(0, 4);
    const latestBySource = new Map<string, RssEntry>();
    for (const entry of entries) {
      if (!latestBySource.has(entry.source_label)) {
        latestBySource.set(entry.source_label, entry);
      }
    }

    const queries: string[] = [];
    for (const entry of latestBySource.values()) {
      if (queries.length >= 3) break;
      const title = sanitizeExternalContent(entry.title).slice(0, MAX_TITLE_LENGTH);
      if (title.length === 0) continue;
      const query = title.length < 20 ? `${title} ${year}` : title;
      queries.push(query);
    }

    if (queries.length < 2) {
      queries.push(`LLM RAG agent latest news ${year}`);
    }

    return queries.slice(0, 3);
  }

  private mergeWithTavilyResults(
    rssEntries: RssEntry[],
    tavilyResults: SearchResult[],
  ): RssEntry[] {
    const seenUrls = new Set(rssEntries.map((entry) => entry.link));
    const merged = [...rssEntries];

    for (const result of tavilyResults) {
      if (seenUrls.has(result.url)) continue;
      seenUrls.add(result.url);
      merged.push({
        source_label: "Tavily",
        source_url: result.url,
        title: result.title,
        link: result.url,
        summary: result.content,
        published_at: new Date().toISOString(),
      });
    }

    return merged;
  }

  private buildFullTextMap(
    extractResults: ExtractResult[],
    priorityUrls: Set<string>,
  ): Map<string, string> {
    const map = new Map<string, string>();
    let totalChars = 0;

    const sortedResults = [...extractResults].sort((a, b) => {
      const aIsOfficial = priorityUrls.has(a.url) ? 0 : 1;
      const bIsOfficial = priorityUrls.has(b.url) ? 0 : 1;
      return aIsOfficial - bIsOfficial;
    });

    for (const result of sortedResults) {
      if (totalChars >= TAVILY_CONTEXT_MAX_TOTAL_CHARS) break;
      if (!result.raw_content) continue;

      const remaining = TAVILY_CONTEXT_MAX_TOTAL_CHARS - totalChars;
      const trimmed = sanitizeExternalContent(result.raw_content).slice(
        0,
        Math.min(TAVILY_CONTENT_MAX_CHARS, remaining),
      );
      map.set(result.url, trimmed);
      totalChars += trimmed.length;
    }

    return map;
  }
}
