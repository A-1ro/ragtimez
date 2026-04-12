---
name: Tavily RAG Pipeline
description: Tavily API integration for full-text RAG in generate-article — search, extract, merge, and context injection patterns
type: project
---

Tavily RAG pipeline was added to `/api/generate-article` as an optional enhancement. When `TAVILY_API_KEY` is set, the pipeline runs between D1 RSS retrieval and LLM generation.

**Pipeline order:**
1. D1 → RSS entries (up to `MAX_CONTEXT_ENTRIES = 20`)
2. `buildTavilyQueries()` → up to 3 queries from unique `source_label` values
3. `tavilySearch()` → parallel fetch, deduped by URL
4. `mergeWithTavilyResults()` → Tavily URLs appended after RSS, capped at 20
5. `tavilyExtract()` → official URLs first, max `TAVILY_EXTRACT_MAX_URLS = 8`
6. `buildFullTextMap()` → URL→trimmed body map, total cap `TAVILY_CONTEXT_MAX_TOTAL_CHARS = 40_000`
7. `buildContext(entries, fullTextMap)` → uses full text when available, label changes from "Summary:" to "Full content (truncated):"
8. `generateWithLLM(..., fullTextMap)` → `hasFullText` flag adjusts Step 0 and Step 2 prompts

**Key design decisions:**
- `TAVILY_API_KEY` is optional; unset → existing RSS-only behavior unchanged
- All Tavily errors caught gracefully; fallback to RSS summaries logged as `console.warn`
- Per-article cap: `TAVILY_CONTENT_MAX_CHARS = 2000` chars (~500-700 tokens)
- Step 0 (topic selection) still uses summaries only to save tokens; full text injected for Steps 1 & 2

**Why:** Issue #23 — RSS summaries alone are insufficient for RAG; full body text enables specific version numbers, code examples, and benchmarks in generated articles.

**How to apply:** When modifying the article generation pipeline, ensure the `fullTextMap` optional parameter flows through correctly. Never log the raw Tavily API key.
