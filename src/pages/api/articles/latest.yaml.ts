import { getCollection } from "astro:content";
import type { APIContext } from "astro";

function yamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function indentBlock(text: string, indent: number): string {
  const pad = " ".repeat(indent);
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? "" : pad + line))
    .join("\n");
}

export async function GET(context: APIContext) {
  const articles = await getCollection(
    "articles",
    ({ data }) => !data.draft && data.lang === "ja"
  );
  const sorted = articles.sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime()
  );
  const latest = sorted[0];

  if (!latest) {
    return new Response("# no articles available\n", {
      status: 404,
      headers: { "Content-Type": "text/yaml; charset=utf-8" },
    });
  }

  const { data, body, id } = latest;
  const siteOrigin =
    context.site?.toString().replace(/\/$/, "") ?? "https://ragtimez.com";

  const lines: string[] = [];
  lines.push(`slug: ${yamlString(id)}`);
  lines.push(`title: ${yamlString(data.title)}`);
  lines.push(`date: ${data.date.toISOString().slice(0, 10)}`);
  lines.push(`lang: ja`);
  lines.push(`trustLevel: ${data.trustLevel}`);
  lines.push(`url: ${yamlString(`${siteOrigin}/articles/${id}/`)}`);
  lines.push(`summary: ${yamlString(data.summary)}`);

  if (data.tags.length > 0) {
    lines.push(`tags:`);
    for (const tag of data.tags) {
      lines.push(`  - ${yamlString(tag)}`);
    }
  } else {
    lines.push(`tags: []`);
  }

  if (data.sources.length > 0) {
    lines.push(`sources:`);
    for (const src of data.sources) {
      lines.push(`  - url: ${yamlString(src.url)}`);
      if (src.title) lines.push(`    title: ${yamlString(src.title)}`);
      if (src.type) lines.push(`    type: ${src.type}`);
    }
  } else {
    lines.push(`sources: []`);
  }

  lines.push(`markdown: |`);
  lines.push(indentBlock(body ?? "", 2));

  const yaml = lines.join("\n").replace(/\n+$/, "") + "\n";

  return new Response(yaml, {
    status: 200,
    headers: {
      "Content-Type": "text/yaml; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=3600",
    },
  });
}
