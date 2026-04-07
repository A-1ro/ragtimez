/// <reference types="node" />
/**
 * scripts/setup-ai-search.ts
 *
 * One-shot setup script that registers all crawl targets defined in
 * src/constants/crawlTargets.ts with Cloudflare AI Search via the REST API.
 *
 * Prerequisites
 * -------------
 *   export CLOUDFLARE_ACCOUNT_ID="<your-account-id>"
 *   export CLOUDFLARE_API_TOKEN="<token-with-AI-Search-write-permission>"
 *
 * Usage
 * -----
 *   npm run setup:ai-search
 *
 * What it does
 * ------------
 * 1. Reads CRAWL_TARGETS from src/constants/crawlTargets.ts
 * 2. For each target URL, calls the Cloudflare AI Search "add source" endpoint
 *    POST /accounts/{account_id}/ai-search/indexes/ai-tech-daily-search/sources
 * 3. Prints a success/failure summary so you can verify the registrations
 *
 * After running this script you can verify the registrations in the
 * Cloudflare Dashboard under  AI > AI Search > Sources.
 */

import { AI_SEARCH_INDEX_NAME, CRAWL_TARGETS } from "../src/constants/crawlTargets.js";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error(
    "Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set as environment variables."
  );
  process.exit(1);
}

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-search/indexes/${AI_SEARCH_INDEX_NAME}/sources`;

interface CloudflareApiResult {
  success: boolean;
  errors: { code: number; message: string }[];
}

async function registerSource(url: string): Promise<CloudflareApiResult> {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable body)");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as CloudflareApiResult;
}

async function main() {
  console.log(`Registering ${CRAWL_TARGETS.length} crawl targets with Cloudflare AI Search…\n`);

  let successCount = 0;
  let failCount = 0;

  for (const target of CRAWL_TARGETS) {
    process.stdout.write(`  [${target.label}] ${target.url} … `);
    try {
      const result = await registerSource(target.url);
      if (result.success) {
        console.log("✓ registered");
        successCount++;
      } else {
        const msgs = result.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
        console.log(`✗ failed (${msgs})`);
        failCount++;
      }
    } catch (err) {
      console.log(`✗ error (${String(err)})`);
      failCount++;
    }
  }

  console.log(`\nDone. ${successCount} succeeded, ${failCount} failed.`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main();
