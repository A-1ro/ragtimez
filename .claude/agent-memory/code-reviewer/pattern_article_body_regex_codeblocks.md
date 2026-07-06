---
name: Article Body Markdown Regex Must Be Fence-Aware
description: Any regex/text processing over generated article Markdown (src/lib/article-generation/*) that scans for "## " section boundaries must exclude fenced code blocks, or it will misparse — confirmed bug in CitationIntegrityChecker.ts (2026-07-03 review)
type: project
---

DraftGenerator.ts explicitly instructs the LLM to include fenced (```) code blocks with CLI commands/config snippets inside article sections. Any line starting with `##` at column 0 inside such a fenced block (e.g. a shell script section-comment idiom like `## Configuration`, or a code sample demonstrating Markdown itself) will falsely match a naive `/^##\s+/m` section-boundary split.

Confirmed via empirical test (2026-07-03 review of CitationIntegrityChecker.ts, added alongside DraftGenerator/TopicSelector prompt fixes for the 2026-07-03 quality-audit incident — 3 mixed topics + fabricated "API Gateway tutorials" section + 100% citation-fallback failure): `CitationIntegrityChecker.analyze()` splits `body.split(/^##\s+/m)` without stripping code fences first, so a properly-cited section containing a fenced code block with an internal `##`-prefixed line gets truncated mid-section and false-flagged as "unsourced" in the console.warn log — even though the real citation is present later in the same logical section, just past the fake split point. This only inflates a non-gating log signal (no control-flow/publication impact), but repeated false positives would erode trust in exactly the kind of automated alarm meant to catch the incident that motivated building it.

**How to apply:** When reviewing new code in `src/lib/article-generation/` that regex-scans the LLM-generated Markdown body (section splitting, citation extraction, heading detection, etc.), check whether it strips/skips fenced code blocks first. The established, correct pattern already in the codebase is in `PostProcessor.ts`: `body.split(/(```[\s\S]*?```)/g)` then only transform the even-indexed (non-code) segments. Flag any new text-processing logic that scans the raw body directly without this fence-aware segmentation as a Warning.
