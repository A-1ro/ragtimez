import type { ArticleSource } from "./types";

function yamlEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildMarkdown(
  llm: { title: string; summary: string; tags: string[]; body: string },
  date: string,
  sources: ArticleSource[],
  trustLevel: "official" | "blog" | "speculative",
  lang: "ja" | "en" = "ja",
): string {
  const sourcesYaml = sources
    .map((s) => {
      const title = s.title ? `\n    title: "${yamlEscape(s.title)}"` : "";
      return `  - url: "${yamlEscape(s.url)}"${title}\n    type: "${s.type}"`;
    })
    .join("\n");
  const tagsYaml = llm.tags.map((t) => `  - "${yamlEscape(t)}"`).join("\n");

  return `---
title: "${yamlEscape(llm.title)}"
date: ${date}
summary: "${yamlEscape(llm.summary)}"
sources:
${sourcesYaml}
trustLevel: "${trustLevel}"
tags:
${tagsYaml}
draft: false
lang: ${lang}
---

${llm.body.trim()}
`;
}
