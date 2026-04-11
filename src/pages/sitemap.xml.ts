import { getCollection } from "astro:content";
import type { APIContext } from "astro";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET(context: APIContext) {
  const siteUrl = (context.site ?? new URL(context.url.origin)).href.replace(
    /\/$/,
    ""
  );

  const articles = await getCollection("articles", ({ data }) => !data.draft);

  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${siteUrl}/` },
    ...articles.map((article) => ({
      loc: `${siteUrl}/articles/${article.id}/`,
      lastmod: article.data.date.toISOString(),
    })),
  ];

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        ({ loc, lastmod }) =>
          `  <url>\n    <loc>${escapeXml(loc)}</loc>` +
          (lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "") +
          `\n  </url>`
      )
      .join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
