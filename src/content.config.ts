import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const trustLevelSchema = z.enum(["official", "blog", "speculative"]);

// Source type classifies the individual source document.
// trustLevel (below) classifies the overall reliability of the article.
const sourceSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  type: z.enum(["official", "blog", "other"]).optional(),
});

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    sources: z.array(sourceSchema).default([]),
    trustLevel: trustLevelSchema,
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles };
