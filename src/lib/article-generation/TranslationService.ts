import { getCollection } from "astro:content";
import type { ITranslationService } from "./interfaces";
import { stripOuterMarkdownFence } from "./textUtils";
import type { ArticleSource, RssEntry } from "./types";
import { extractText } from "../llm/extractText";

const TRANSLATION_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

export interface TranslationSource {
  title: string;
  summary: string;
  tags: string[];
  body: string;
  sources: ArticleSource[];
  trustLevel: "official" | "blog" | "speculative";
}

export interface TranslationResult {
  title: string;
  summary: string;
  tags: string[];
  body: string;
  selectedTopic: string;
  selectedEntries: RssEntry[];
}

export class TranslationService implements ITranslationService {
  constructor(
    private readonly ai: {
      run(model: string, options: unknown): Promise<unknown>;
    },
  ) {}

  parseArticleMarkdown(raw: string): TranslationSource | null {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = match[1];
    const body = match[2].trim();
    if (!body) return null;

    const titleMatch = frontmatter.match(/^title:\s*"((?:[^"\\]|\\.)*)"\s*$/m);
    if (!titleMatch) return null;
    const title = titleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");

    const summaryMatch = frontmatter.match(/^summary:\s*"((?:[^"\\]|\\.)*)"\s*$/m);
    const summary = summaryMatch
      ? summaryMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : "";

    const trustMatch = frontmatter.match(/^trustLevel:\s*"([^"]+)"\s*$/m);
    const rawTrust = trustMatch?.[1] ?? "speculative";
    const trustLevel: "official" | "blog" | "speculative" =
      rawTrust === "official" || rawTrust === "blog" ? rawTrust : "speculative";

    const tags: string[] = [];
    const tagsBlockMatch = frontmatter.match(/^tags:\n((?:[ \t]+-[ \t]+"[^"]*"\n?)*)/m);
    if (tagsBlockMatch) {
      for (const match of tagsBlockMatch[1].matchAll(/[ \t]+-[ \t]+"([^"]*)"/gm)) {
        tags.push(match[1]);
      }
    }

    const sources: ArticleSource[] = [];
    const frontmatterLines = frontmatter.split("\n");
    const unescapeYamlQuoted = (value: string): string =>
      value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");

    let inSources = false;
    let currentSource: ArticleSource | null = null;

    const pushCurrentSource = () => {
      if (!currentSource) return;
      sources.push(currentSource);
      currentSource = null;
    };

    for (const line of frontmatterLines) {
      if (!inSources) {
        if (line === "sources:") inSources = true;
        continue;
      }

      if (/^\S/.test(line)) {
        pushCurrentSource();
        break;
      }

      const urlMatch = line.match(/^[ \t]+-[ \t]+url:\s*"((?:[^"\\]|\\.)*)"\s*$/);
      if (urlMatch) {
        pushCurrentSource();
        currentSource = {
          url: unescapeYamlQuoted(urlMatch[1]),
          type: "other",
        };
        continue;
      }

      if (!currentSource) continue;

      const sourceTitleMatch = line.match(/^[ \t]+title:\s*"((?:[^"\\]|\\.)*)"\s*$/);
      if (sourceTitleMatch) {
        currentSource.title = unescapeYamlQuoted(sourceTitleMatch[1]);
        continue;
      }

      const typeMatch = line.match(/^[ \t]+type:\s*"([^"]+)"\s*$/);
      if (typeMatch) {
        currentSource.type =
          typeMatch[1] === "official" || typeMatch[1] === "blog"
            ? typeMatch[1]
            : "other";
      }
    }

    pushCurrentSource();

    return { title, summary, tags, body, sources, trustLevel };
  }

  async resolveTranslationSource(input: {
    date: string;
    lang: "ja" | "en";
    jaArticleContent?: string;
  }): Promise<TranslationSource | null> {
    if (input.lang !== "en") return null;

    const jaArticleContent = input.jaArticleContent?.trim() ?? "";
    if (jaArticleContent) {
      try {
        const parsed = this.parseArticleMarkdown(jaArticleContent);
        if (parsed) {
          console.log("Translation mode: using jaArticleContent from request body");
          return parsed;
        }
        console.warn(
          "Translation mode: failed to parse jaArticleContent from request body, trying Content Collection",
        );
      } catch (err) {
        console.warn(
          `Translation mode: jaArticleContent parse error, trying Content Collection: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    try {
      const articles = await getCollection("articles");
      const jaArticle = articles.find(
        (article: {
          id: string;
          data: {
            lang?: string;
            title: string;
            summary: string;
            tags: string[];
            sources: ArticleSource[];
            trustLevel: "official" | "blog" | "speculative";
          };
          body?: string;
        }) =>
          article.id === input.date &&
          (article.data.lang === "ja" || article.data.lang === undefined),
      );
      if (!jaArticle) {
        console.log(
          `Translation mode: no Japanese article found for ${input.date}, falling back to full generation`,
        );
        return null;
      }

      console.log(
        `Translation mode: found Japanese article in Content Collection for ${input.date}, skipping D1/Tavily`,
      );
      return {
        title: jaArticle.data.title,
        summary: jaArticle.data.summary,
        tags: jaArticle.data.tags,
        body: (jaArticle as unknown as { body?: string }).body ?? "",
        sources: jaArticle.data.sources as ArticleSource[],
        trustLevel: jaArticle.data.trustLevel as "official" | "blog" | "speculative",
      };
    } catch (err) {
      console.warn(
        `Translation mode check failed, falling back to full generation: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  async translateArticle(
    source: TranslationSource,
    _date: string,
  ): Promise<TranslationResult> {
    const metaSystemPrompt =
      "You are a professional translator. Translate the following Japanese article metadata to English.\n" +
      'Output valid JSON with keys: "title", "summary", "tags" (array of strings).\n' +
      "Keep technical terms (API names, model names, company names) as-is.\n" +
      "The title should be concise (15-50 chars). The summary should be 2-3 sentences.\n" +
      "Output only the JSON, nothing else.";

    const metaUserPrompt = JSON.stringify({
      title: source.title,
      summary: source.summary,
      tags: source.tags,
    });

    const metaResponse = await this.ai.run(TRANSLATION_MODEL, {
      messages: [
        { role: "system", content: metaSystemPrompt },
        { role: "user", content: metaUserPrompt },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    });

    const metaRaw = extractText(metaResponse)
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let translatedMeta: { title: string; summary: string; tags: string[] };
    try {
      const parsed = JSON.parse(metaRaw);
      if (
        typeof parsed.title !== "string" ||
        typeof parsed.summary !== "string" ||
        !Array.isArray(parsed.tags) ||
        !parsed.tags.every((tag: unknown) => typeof tag === "string")
      ) {
        throw new Error("Schema validation failed");
      }
      translatedMeta = {
        title: parsed.title.slice(0, 200),
        summary: parsed.summary.slice(0, 500),
        tags: (parsed.tags as string[]).slice(0, 10).map((tag) => tag.slice(0, 50)),
      };
    } catch {
      const titleMatch = /"title"\s*:\s*"([^"]+)"/.exec(metaRaw);
      const summaryMatch = /"summary"\s*:\s*"([^"]+)"/.exec(metaRaw);
      const tagsMatch = /"tags"\s*:\s*\[([\s\S]*?)\]/.exec(metaRaw);
      if (!titleMatch || !summaryMatch) {
        throw new Error(`Translation metadata parse failed. Raw: ${metaRaw.slice(0, 300)}`);
      }
      translatedMeta = {
        title: titleMatch[1].trim().slice(0, 200),
        summary: summaryMatch[1].replace(/,\s*$/, "").trim().slice(0, 500),
        tags: tagsMatch
          ? (tagsMatch[1].match(/"([^"]+)"/g) ?? [])
              .map((tag) => tag.replace(/"/g, "").slice(0, 50))
              .slice(0, 10)
          : [],
      };
    }

    console.log(`Step T1 metadata translated: title="${translatedMeta.title}"`);

    const bodySystemPrompt =
      "You are a professional translator specializing in technical content.\n" +
      "Translate the following Japanese Markdown article to English.\n" +
      "Preserve all Markdown formatting (headings, lists, code blocks, links, bold, etc.) exactly.\n" +
      "Keep technical terms, API names, model names, URLs, and code snippets as-is.\n" +
      "Maintain the same paragraph structure and section headings.\n" +
      "The last section ## まとめ should be translated as ## Summary.\n" +
      "Output only the translated Markdown, nothing else.";

    const bodyResponse = await this.ai.run(TRANSLATION_MODEL, {
      messages: [
        { role: "system", content: bodySystemPrompt },
        { role: "user", content: source.body },
      ],
      max_tokens: 4096,
      temperature: 0.3,
    });

    const translatedBody = stripOuterMarkdownFence(extractText(bodyResponse));
    if (!translatedBody) {
      throw new Error("Translation returned empty body");
    }

    console.log(`Step T2 body translated: ${translatedBody.length} chars`);

    return {
      ...translatedMeta,
      body: translatedBody,
      selectedTopic: source.title,
      selectedEntries: [],
    };
  }
}
