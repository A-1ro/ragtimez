import type { IFactualIntegrityValidator } from "./interfaces";

/** One `URL1(URL2)` pair inside a malformed bare-URL citation block. */
const NESTED_URL_PAIR = /(https?:\/\/[^\s（）()]+)\((?:https?:\/\/[^\s（）()]*)?\)/g;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Rebuilds one malformed citation block's inner content into well-formed
 * `[hostname](url1), [hostname](url2)` Markdown links, keeping only the first
 * (longer, more specific) URL of each `URL1(URL2)` pair — URL2 is either a
 * verbatim duplicate of URL1 or a truncated domain-root variant, never new
 * information.
 */
function rebuildLinks(inner: string, separator: string): string {
  const links: string[] = [];
  for (const match of inner.matchAll(NESTED_URL_PAIR)) {
    links.push(`[${hostnameOf(match[1])}](${match[1]})`);
  }
  return links.join(separator);
}

export class FactualIntegrityValidator implements IFactualIntegrityValidator {
  validate(body: string): string {
    let result = body;

    // Fix 1: a Markdown link whose href slot contains a nested `[label](url)`
    // pair instead of a bare URL, e.g. `[Amazon Bedrock]([https://x](https://x))`.
    // Such links render broken (literal brackets shown to the reader instead of
    // a clickable link).
    result = result.replace(
      /\[([^\[\]]+)\]\(\[[^\[\]]*\]\(([^()\s]+)\)\)/g,
      (_match, label: string, url: string) => `[${label}](${url})`,
    );

    // Fix 2: a malformed bare-URL citation where the model nests a second URL
    // in a parenthetical instead of using Markdown link syntax, and never emits
    // the closing full-width paren — e.g.
    // `（出典: https://x/page(https://x/))` (no trailing `）` at all). This is the
    // exact anti-pattern DraftGenerator's own prompt calls out as forbidden
    // ("BAD ... never do this"), but because it has no closing `）`, none of
    // PostProcessor's citation regexes (which all require one) ever match it,
    // so it survives untouched into the published article as a raw, broken URL
    // blob instead of a clickable citation. Repairing it here — after
    // PostProcessor has already run — catches it regardless of why the earlier
    // pass missed it, without changing PostProcessor's own matching rules.
    result = result.replace(
      /（出典:\s*((?:https?:\/\/[^\s（）()]+\((?:https?:\/\/[^\s（）()]*)?\)(?:[,、]\s*)?)+)\)/g,
      (_match, inner: string) => `（出典: ${rebuildLinks(inner, "、")}）`,
    );
    result = result.replace(
      /\(Source:\s*((?:https?:\/\/[^\s()]+\((?:https?:\/\/[^\s()]*)?\)(?:,\s*)?)+)\)/gi,
      (_match, inner: string) => `(Source: ${rebuildLinks(inner, ", ")})`,
    );

    return result;
  }
}
