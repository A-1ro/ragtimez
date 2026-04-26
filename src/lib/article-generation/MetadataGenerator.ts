import type { IMetadataGenerator } from "./interfaces";
import type { ILlmClient } from "../llm/interfaces";

const METADATA_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

export class MetadataGenerator implements IMetadataGenerator {
  constructor(private readonly llmClient: ILlmClient) {}

  async generate(input: {
    draftBody: string;
    lang: "ja" | "en";
  }): Promise<{ title: string; summary: string; tags: string[] }> {
    const system =
      input.lang === "en"
        ? "You are a senior engineer writing a technical blog. " +
          "Read the provided article body and generate metadata that accurately reflects the article's actual content. Output ONLY valid JSON.\n" +
          "The JSON must have exactly these three keys:\n" +
          '- "title": a specific, descriptive English headline (15-50 chars) that summarizes what this article is actually about. Avoid vague words like "Latest updates" or "Summary".\n' +
          '- "summary": 2-3 English sentences explaining WHAT the article covers, WHY it matters technically, and WHAT engineers should do about it.\n' +
          '- "tags": array of 3-5 specific English keywords (model names, API names, company names, specific technologies) that appear in the article.\n' +
          "Output only the JSON object, no markdown fences."
        : "You are a Japanese senior engineer writing a technical blog. " +
          "Read the provided article body and generate metadata that accurately reflects the article's actual content. Output ONLY valid JSON.\n" +
          "The JSON must have exactly these three keys:\n" +
          '- "title": a specific, descriptive Japanese headline (20-50 chars) that summarizes what this article is actually about. Avoid vague words like "最新動向" or "まとめ".\n' +
          '- "summary": 2-3 Japanese sentences explaining WHAT the article covers, WHY it matters technically, and WHAT engineers should do about it.\n' +
          '- "tags": array of 3-5 specific English keywords (model names, API names, company names, specific technologies) that appear in the article.\n' +
          "Output only the JSON object, no markdown fences.";

    const metaRaw = await this.llmClient.generateText({
      model: METADATA_MODEL,
      system,
      user: input.draftBody,
      maxTokens: 256,
      temperature: 0.3,
    });

    const normalized = metaRaw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let meta: { title: string; summary: string; tags: string[] };
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
      if (!titleMatch || !summaryMatch) {
        throw new Error(`Metadata parse failed. Raw: ${normalized.slice(0, 300)}`);
      }
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

    if (!meta.title || !meta.summary) {
      throw new Error(`Metadata missing fields. Raw: ${normalized.slice(0, 300)}`);
    }

    return meta;
  }
}
