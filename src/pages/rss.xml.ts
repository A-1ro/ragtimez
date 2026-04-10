import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const articles = await getCollection("articles", ({ data }) => !data.draft);
  const sorted = articles.sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime()
  );

  const siteUrl = context.site ?? new URL(context.url.origin);

  return rss({
    title: "AI Tech Daily",
    description:
      "AI-powered daily tech blog covering Azure / LLM / RAG / AI Agents",
    site: siteUrl,
    items: sorted.map((article) => ({
      title: article.data.title,
      pubDate: article.data.date,
      description: article.data.summary,
      link: `/articles/${article.id}/`,
      content: article.body,
    })),
    customData: `<language>ja</language>`,
  });
}
