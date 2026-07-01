import type { IFactualIntegrityValidator } from "./interfaces";

/**
 * Fixes a recurring structural artifact from the draft LLM: a Markdown link
 * whose href slot contains a nested `[label](url)` pair instead of a bare
 * URL, e.g. `[Amazon Bedrock]([https://x](https://x))`. Such links render
 * broken (literal brackets shown to the reader instead of a clickable link).
 *
 * This is a mechanical, deterministic fix — it does not attempt to judge
 * factual correctness, so it is safe to run unconditionally on every article
 * without risking false positives on legitimate content.
 */
export class FactualIntegrityValidator implements IFactualIntegrityValidator {
  validate(body: string): string {
    return body.replace(
      /\[([^\[\]]+)\]\(\[[^\[\]]*\]\(([^()\s]+)\)\)/g,
      (_match, label: string, url: string) => `[${label}](${url})`,
    );
  }
}
