import { postProcess } from "./PostProcessor";
import { SOURCE_QUALITY_MAX_RETRIES, SOURCE_QUALITY_THRESHOLD } from "./constants";
import type {
  IDraftGenerator,
  IMetadataGenerator,
  IResearchEnricher,
  SearchUsageBudget,
  ITopicSelector,
} from "./interfaces";
import type { RecentArticle } from "./TopicSelector";
import { checkTopicDuplication, normalizeUrl } from "./topicDeduplication";
import type { RssEntry } from "./types";

export class ArticleGenerationOrchestrator {
  constructor(
    private readonly topicSelector: ITopicSelector,
    private readonly researchEnricher: IResearchEnricher,
    private readonly metadataGenerator: IMetadataGenerator,
    private readonly draftGenerator: IDraftGenerator,
  ) {}

  async generate(input: {
    entries: RssEntry[];
    date: string;
    lang: "ja" | "en";
    pastArticles: RecentArticle[];
    fullTextMap?: Map<string, string>;
    searchBudget: SearchUsageBudget;
    db?: D1Database;
  }): Promise<{
    title: string;
    summary: string;
    tags: string[];
    body: string;
    selectedTopic: string;
    selectedEntries: RssEntry[];
  }> {
    const rejectedTopics: string[] = [];
    let bestAttempt: {
      topicSelection: { topic: string; reason: string; indices: number[] };
      selectedEntries: RssEntry[];
      fullTextMap?: Map<string, string>;
      score: number;
    } | null = null;

    const hasFullTextInitial = input.fullTextMap !== undefined && input.fullTextMap.size > 0;
    const maxAttempts = SOURCE_QUALITY_MAX_RETRIES + 1;

    // Pre-filter RSS entries: exclude entries whose URL already appears in a past article's sources.
    // This reduces the chance of the LLM topic selector picking up stale entries.
    const pastSourceUrls = new Set(
      input.pastArticles.flatMap((a) => a.sourceUrls.map(normalizeUrl)),
    );
    const filteredEntries = input.entries.filter(
      (e) => !pastSourceUrls.has(normalizeUrl(e.link)),
    );
    const effectiveEntries = filteredEntries.length >= 3 ? filteredEntries : input.entries;
    console.log(
      `RSS事前フィルタ: ${input.entries.length}件中${filteredEntries.length}件が未使用`,
    );

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const selection = await this.topicSelector.select({
        entries: effectiveEntries,
        pastArticles: input.pastArticles,
        rejectedTopics,
        hasFullTextInitial,
      });

      // Programmatic deduplication check (before expensive enrichment)
      const dedup = checkTopicDuplication(
        selection.selectedEntries,
        input.pastArticles,
        selection.topicSelection.topic,
      );
      if (dedup.isDuplicate) {
        console.log(
          `トピック重複検出（試行 ${attempt + 1}/${maxAttempts}）: "${selection.topicSelection.topic}" ↔ ` +
          `"${dedup.matchedArticle?.title}" (URL重複率=${dedup.urlOverlapRatio.toFixed(2)}, タグ類似度=${dedup.tagOverlapRatio.toFixed(2)})`,
        );
        rejectedTopics.push(selection.topicSelection.topic);
        continue;
      }

      const enriched = await this.researchEnricher.enrichSelectedTopic({
        topic: selection.topicSelection.topic,
        selectedEntries: selection.selectedEntries,
        fullTextMap: input.fullTextMap,
        searchBudget: input.searchBudget,
        attempt,
      });

      const quality = this.researchEnricher.evaluateSourceQuality(
        enriched.selectedEntries,
        enriched.fullTextMap,
      );
      console.log(
        `ソース品質評価（試行 ${attempt + 1}/${maxAttempts}）: score=${quality.score}/${SOURCE_QUALITY_THRESHOLD}, fullText=${quality.details.fullTextCount}, official=${quality.details.officialCount}, totalChars=${quality.details.totalChars}`,
      );

      const currentAttempt = {
        topicSelection: selection.topicSelection,
        selectedEntries: enriched.selectedEntries,
        fullTextMap: enriched.fullTextMap,
        score: quality.score,
      };

      if (!bestAttempt || quality.score > bestAttempt.score) {
        bestAttempt = currentAttempt;
      }

      if (quality.score >= SOURCE_QUALITY_THRESHOLD) {
        console.log(`トピック採用: "${selection.topicSelection.topic}"`);
        break;
      }

      console.log(
        `トピック却下（score ${quality.score} < ${SOURCE_QUALITY_THRESHOLD}）: "${selection.topicSelection.topic}"`,
      );
      rejectedTopics.push(selection.topicSelection.topic);
    }

    // Fallback: if every attempt was rejected by dedup, run one final attempt
    // without the dedup check to guarantee an article is always produced.
    if (!bestAttempt) {
      console.warn("全試行がトピック重複で却下。重複チェックなしで最終試行を実行します。");
      const lastSelection = await this.topicSelector.select({
        entries: effectiveEntries,
        pastArticles: input.pastArticles,
        rejectedTopics: [],
        hasFullTextInitial,
      });
      const enriched = await this.researchEnricher.enrichSelectedTopic({
        topic: lastSelection.topicSelection.topic,
        selectedEntries: lastSelection.selectedEntries,
        fullTextMap: input.fullTextMap,
        searchBudget: input.searchBudget,
        attempt: maxAttempts,
      });
      const quality = this.researchEnricher.evaluateSourceQuality(
        enriched.selectedEntries,
        enriched.fullTextMap,
      );
      bestAttempt = {
        topicSelection: lastSelection.topicSelection,
        selectedEntries: enriched.selectedEntries,
        fullTextMap: enriched.fullTextMap,
        score: quality.score,
      };
    }

    const finalAttempt = bestAttempt!;
    if (rejectedTopics.length > 0 && finalAttempt.score < SOURCE_QUALITY_THRESHOLD) {
      console.log(
        `全試行がソース品質閾値未満。最良スコア ${finalAttempt.score} の試行を採用: "${finalAttempt.topicSelection.topic}"`,
      );
    }

    const hasFullText = finalAttempt.fullTextMap !== undefined && finalAttempt.fullTextMap.size > 0;
    const context = this.researchEnricher.buildContext(
      finalAttempt.selectedEntries,
      finalAttempt.fullTextMap,
    );
    const contextBlock = `Today is ${input.date}.\n\n${context}`;

    const metadata = await this.metadataGenerator.generate({
      context,
      lang: input.lang,
    });

    const draftBody = await this.draftGenerator.generate({
      contextBlock,
      lang: input.lang,
      hasFullText,
    });
    if (!draftBody) throw new Error("LLM returned empty draft body");
    console.log(`Step 2a draft complete: ${draftBody.length} chars`);

    let finalBody = draftBody;
    try {
      if (input.db) {
        finalBody = await postProcess(draftBody, finalAttempt.selectedEntries, input.db);
        console.log(`Step 2b post-processing complete: ${finalBody.length} chars`);
      } else {
        console.warn("Step 2b post-processing skipped: db not provided");
      }
    } catch (err) {
      console.warn(
        `Step 2b post-processing failed, using draft: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      ...metadata,
      body: finalBody,
      selectedTopic: finalAttempt.topicSelection.topic,
      selectedEntries: finalAttempt.selectedEntries,
    };
  }
}
