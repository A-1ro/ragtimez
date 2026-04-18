import { postProcess } from "./PostProcessor";
import { SOURCE_QUALITY_MAX_RETRIES, SOURCE_QUALITY_THRESHOLD } from "./constants";
import type {
  IDraftGenerator,
  IMetadataGenerator,
  IResearchEnricher,
  ITopicSelector,
} from "./interfaces";
import type { TavilyUsageBudget } from "./ResearchEnricher";
import type { RecentArticle } from "./TopicSelector";
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
    tavilyBudget: TavilyUsageBudget;
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

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const selection = await this.topicSelector.select({
        entries: input.entries,
        pastArticles: input.pastArticles,
        rejectedTopics,
        hasFullTextInitial,
      });

      const enriched = await this.researchEnricher.enrichSelectedTopic({
        topic: selection.topicSelection.topic,
        selectedEntries: selection.selectedEntries,
        fullTextMap: input.fullTextMap,
        tavilyBudget: input.tavilyBudget,
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
