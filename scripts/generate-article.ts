/// <reference types="node" />
/**
 * scripts/generate-article.ts
 *
 * Calls POST /api/generate-article on a running Cloudflare Pages deployment
 * (or local wrangler dev server) and writes the resulting Markdown to
 * src/content/articles/YYYY-MM-DD.md.
 *
 * Prerequisites
 * -------------
 *   export GENERATE_ARTICLE_URL="https://<your-pages-domain>"   # or http://localhost:8788
 *   export INTERNAL_API_TOKEN="<same-secret-as-Cloudflare-Pages>"
 *
 * Usage
 * -----
 *   npm run generate:article
 *   npm run generate:article -- --date 2026-04-08
 *   npm run generate:article -- --date 2026-04-08 --force
 *   npm run generate:article -- --topics "OpenAI news" "Azure AI updates"
 *   npm run generate:article -- --lang en
 *
 * Options
 *   --date    YYYY-MM-DD   Article date (default: today UTC)
 *   --force               Overwrite existing file
 *   --topics  ...strings  One or more search topics (space-separated)
 *   --limit   number      AI Search results per topic (default 5)
 *   --lang    ja|en       Article language (default: ja)
 */

import { writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

/** Returns true when a CLI argument looks like a named flag (--foo). */
function isFlag(arg: string): boolean {
  return /^--[a-zA-Z]/.test(arg);
}

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const next = args[idx + 1];
  // Guard: if the next token looks like a flag itself, there is no value.
  if (next === undefined || isFlag(next)) return undefined;
  return next;
}

function getFlagAll(flag: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      // Collect all following values until we hit another named flag.
      i++;
      while (i < args.length && !isFlag(args[i])) {
        results.push(args[i]);
        i++;
      }
      i--; // Compensate for the outer for-loop's i++ so args[i] (next flag) is reprocessed correctly
    }
  }
  return results;
}

const forceOverwrite = args.includes("--force");
const dateArg = getFlag("--date");
const limitArg = getFlag("--limit");
const topicsArg = getFlagAll("--topics");
const langArg = getFlag("--lang") ?? "ja";

const today = new Date().toISOString().slice(0, 10);
const articleDate = dateArg ?? today;

if (!/^\d{4}-\d{2}-\d{2}$/.test(articleDate)) {
  console.error(`Error: --date must be in YYYY-MM-DD format, got: ${articleDate}`);
  process.exit(1);
}

if (langArg !== "ja" && langArg !== "en") {
  console.error(`Error: --lang must be "ja" or "en", got: ${langArg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------
const BASE_URL = (process.env.GENERATE_ARTICLE_URL ?? "http://localhost:8788").replace(/\/$/, "");
const TOKEN = process.env.INTERNAL_API_TOKEN;

if (!TOKEN) {
  console.error(
    "Error: INTERNAL_API_TOKEN environment variable must be set.\n" +
    "  export INTERNAL_API_TOKEN=\"<your-secret-token>\""
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Output path will be determined from API response filename
// ---------------------------------------------------------------------------
const repoRoot = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------
interface ArticleMetadata {
  title: string;
  date: string;
  summary: string;
  trustLevel: string;
  tags: string[];
  sources: { url: string; title?: string; type: string }[];
  draft: boolean;
}

interface GeneratedArticle {
  filename: string;
  content: string;
  metadata: ArticleMetadata;
}

const requestBody: Record<string, unknown> = { date: articleDate, lang: langArg };
if (topicsArg.length > 0) requestBody.topics = topicsArg;
if (limitArg !== undefined) {
  const limit = parseInt(limitArg, 10);
  if (!Number.isFinite(limit) || limit < 1) {
    console.error(`Error: --limit must be a positive integer, got: ${limitArg}`);
    process.exit(1);
  }
  requestBody.searchLimit = limit;
}

console.log(`Generating article for ${articleDate} (lang: ${langArg})…`);
console.log(`  Endpoint : ${BASE_URL}/api/generate-article`);
if (topicsArg.length > 0) console.log(`  Topics   : ${topicsArg.join(", ")}`);

let response: Response;
try {
  response = await fetch(`${BASE_URL}/api/generate-article`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
} catch (err) {
  console.error(`Error: Failed to reach ${BASE_URL}/api/generate-article`);
  console.error(`  ${String(err)}`);
  process.exit(1);
}

if (!response.ok) {
  const body = await response.text().catch(() => "(unreadable body)");
  console.error(
    `Error: API returned HTTP ${response.status} ${response.statusText}`
  );
  console.error(`  ${body}`);
  process.exit(1);
}

let article: GeneratedArticle;
try {
  article = (await response.json()) as GeneratedArticle;
} catch (err) {
  console.error("Error: Failed to parse API response as JSON");
  console.error(`  ${String(err)}`);
  process.exit(1);
}

if (!article.content || !article.filename) {
  console.error("Error: API response is missing required fields (content, filename)");
  console.error(`  Received: ${JSON.stringify(Object.keys(article))}`);
  process.exit(1);
}

// Resolve output path from API-provided filename
const outputPath = resolve(repoRoot, "src", "content", "articles", article.filename);

if (existsSync(outputPath) && !forceOverwrite) {
  console.log(`Article already exists: ${outputPath}`);
  console.log("Use --force to overwrite.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Write article
// ---------------------------------------------------------------------------
try {
  writeFileSync(outputPath, article.content, "utf8");
} catch (err) {
  console.error(`Error: Failed to write file: ${outputPath}`);
  console.error(`  ${String(err)}`);
  process.exit(1);
}

console.log(`\n✓ Article written to: ${outputPath}`);
console.log(`  Title      : ${article.metadata.title}`);
console.log(`  Trust level: ${article.metadata.trustLevel}`);
console.log(`  Tags       : ${article.metadata.tags.join(", ")}`);
console.log(`  Sources    : ${article.metadata.sources.length}`);
