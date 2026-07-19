import type { IMetadataGenerator } from "./interfaces";
import type { ILlmClient } from "../llm/interfaces";

const METADATA_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

// Vague words that indicate the LLM generated a roundup title instead of a specific one.
const FORBIDDEN_TITLE_JA = [
  "最新動向", "まとめ", "概要", "動向", "トレンド", "ニュース", "アップデート",
  "総合", "紹介", "解説", "特集", "レポート",
];
const FORBIDDEN_TITLE_EN = [
  "latest", "update", "updates", "summary", "overview", "roundup",
  "news", "recap", "highlights", "trends",
];

function hasForbiddenTitle(title: string, lang: "ja" | "en"): boolean {
  const lower = title.toLowerCase();
  const forbidden = lang === "ja" ? FORBIDDEN_TITLE_JA : FORBIDDEN_TITLE_EN;
  return forbidden.some((w) => lower.includes(w.toLowerCase()));
}

export class MetadataGenerator implements IMetadataGenerator {
  constructor(private readonly llmClient: ILlmClient) {}

  async generate(input: {
    draftBody: string;
    lang: "ja" | "en";
  }): Promise<{ title: string; summary: string; tags: string[] }> {
    const baseSystem =
      input.lang === "en"
        ? "You are a senior engineer writing a technical blog. " +
          "Read the provided article body and generate metadata that accurately reflects the article's actual content. Output ONLY valid JSON.\n" +
          "The JSON must have exactly these three keys:\n" +
          '- "title": a specific, descriptive English headline (15-50 chars) that names the EXACT product, service, or technology this article covers. FORBIDDEN words (using any of these causes rejection): "Latest", "Updates", "Summary", "Overview", "Trends", "News", "Roundup", "Evolution", "Developments". Example of BAD title: "AI Agent Latest Trends and Evolution". Example of GOOD title: "Amazon Bedrock AgentCore Payments: Autonomous Agent Transactions via x402".\n' +
          '- "summary": 2-3 English sentences explaining WHAT the article covers, WHY it matters technically, and WHAT engineers should do about it.\n' +
          '- "tags": array of 3-5 specific English keywords (model names, API names, company names, specific technologies) that appear in the article.\n' +
          "Output only the JSON object, no markdown fences."
        : "You are a Japanese senior engineer writing a technical blog. " +
          "Read the provided article body and generate metadata that accurately reflects the article's actual content. Output ONLY valid JSON.\n" +
          "The JSON must have exactly these three keys:\n" +
          '- "title": a specific, descriptive Japanese headline (20-50 chars) that names the EXACT product, service, or technology this article covers. FORBIDDEN words (using any of these causes rejection): "最新動向", "動向", "まとめ", "トレンド", "概要", "ニュース", "アップデート情報", "進化", "現状". Example of BAD title: "AIエージェントの最新動向と技術的進化". Example of GOOD title: "Amazon Bedrock AgentCore Paymentsでエージェント支払いを実装する".\n' +
          '- "summary": 2-3 Japanese sentences explaining WHAT the article covers, WHY it matters technically, and WHAT engineers should do about it. Each sentence must name a specific technology or product and state a concrete outcome — NEVER end with vague phrases like "AIの可能性を広げることができる", "〜を進めることができる", or "〜を理解することが重要".\n' +
          '- "tags": array of 3-5 specific English keywords (model names, API names, company names, specific technologies) that appear in the article.\n' +
          "Output only the JSON object, no markdown fences.";

    // Attempt up to 3 times: first with base system prompt, then with a stricter retry prompt
    // if the generated title contains forbidden vague words. A malformed/garbled LLM response
    // (JSON parse failure with no recoverable title/summary via regex) also consumes a retry
    // instead of throwing immediately — run 118 (2026-07-19) failed outright on the first such
    // response with no second attempt, taking the whole daily run down with it.
    let lastParseError: Error | null = null;
    // Why the previous attempt failed — decides which retry instruction to append.
    let retryReason: "parse" | "forbidden" | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const retryWarning =
        retryReason === "parse"
          ? input.lang === "ja"
            ? "\n\n【再生成指示】前回の応答はJSONとしてパースできませんでした。マークダウンフェンスや説明文を付けず、有効なJSONオブジェクトのみを出力してください。"
            : "\n\nREGENERATION NOTE: Your previous response could not be parsed as JSON. Output ONLY a valid JSON object with no markdown fences or surrounding text."
          : retryReason === "forbidden"
          ? input.lang === "ja"
            ? "\n\n【再生成指示】前回生成したタイトルに禁止ワード（最新動向・まとめ・概要・動向・トレンドなど）が含まれていました。今回は必ず「DiScoFormerによる密度推定の統合」「OpenAI o3のコンテキスト拡張」のように技術名・製品名を明示した具体的なタイトルを生成してください。"
            : "\n\nREGENERATION NOTE: Your previous title contained a forbidden vague word (latest/update/summary/overview/roundup). This time you MUST generate a specific title naming the exact technology or product, e.g. 'OpenAI o3 Context Window Expansion' not 'Latest AI Updates'."
          : "";
      const system = baseSystem + retryWarning;

      const metaRaw = await this.llmClient.generateText({
        model: METADATA_MODEL,
        system,
        user: input.draftBody,
        maxTokens: 256,
        temperature: attempt === 0 ? 0.3 : 0.5,
      });

      const normalized = metaRaw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      let meta: { title: string; summary: string; tags: string[] } | null = null;
      try {
        const parsed = JSON.parse(normalized);
        if (
          typeof parsed.title !== "string" ||
          typeof parsed.summary !== "string" ||
          !Array.isArray(parsed.tags) ||
          !parsed.tags.every((tag: unknown) => typeof tag === "string")
        ) {
          throw new Error("Schema validation failed");
        }
        meta = {
          title: parsed.title.slice(0, 200),
          summary: parsed.summary.slice(0, 500),
          tags: (parsed.tags as string[]).slice(0, 10).map((tag) => tag.slice(0, 50)),
        };
      } catch {
        const titleMatch = /"title"\s*:\s*"([^"]+)"/.exec(normalized);
        const summaryMatch = /"summary"\s*:\s*"([^"]+)"/.exec(normalized);
        const tagsMatch = /"tags"\s*:\s*\[([\s\S]*?)\]/.exec(normalized);
        if (titleMatch && summaryMatch) {
          meta = {
            title: titleMatch[1].trim().slice(0, 200),
            summary: summaryMatch[1].replace(/,\s*$/, "").trim().slice(0, 500),
            tags: tagsMatch
              ? (tagsMatch[1].match(/"([^"]+)"/g) ?? [])
                  .map((tag) => tag.replace(/"/g, "").slice(0, 50))
                  .slice(0, 10)
              : [],
          };
        }
      }

      if (!meta || !meta.title || !meta.summary) {
        lastParseError = new Error(`Metadata parse failed. Raw: ${normalized.slice(0, 300)}`);
        if (attempt < 2) {
          console.warn(`メタデータのパースに失敗、再生成します（試行 ${attempt + 1}/3）: ${lastParseError.message}`);
          retryReason = "parse";
          continue;
        }
        throw lastParseError;
      }

      // Retry on forbidden-word titles until the last attempt. Note: `attempt === 0` here
      // would skip the retry when the first attempt was consumed by a parse failure
      // (parse fail → retry → forbidden title would get accepted without another try).
      if (hasForbiddenTitle(meta.title, input.lang)) {
        if (attempt < 2) {
          console.warn(`メタデータタイトルに禁止ワード検出、再生成します（試行 ${attempt + 1}/3）: "${meta.title}"`);
          retryReason = "forbidden";
          continue;
        }
        console.warn(`再生成後もタイトルに禁止ワードが残存しました（そのまま使用）: "${meta.title}"`);
      }

      return meta;
    }

    // TypeScript requires a return here but the loop always returns/throws above.
    throw lastParseError ?? new Error("Metadata generation failed after retries");
  }
}
