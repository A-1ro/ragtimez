import type { ICitationFormatNormalizer } from "./interfaces";

// Matches `（出典: url1(url2)）` / `(Source: url1(url2))` where the draft LLM wrote a
// bare URL followed by a parenthesized second URL instead of `[title](url)` Markdown
// link syntax. In the Japanese form this also leaves the citation's full-width opening
// paren「（」closed by a half-width「)」, which is why every existing regex that expects
// either a Markdown link or a matching full-width closer (removeSummaryCitations,
// stripFabricatedCitations, CitationIntegrityChecker) silently fails to recognize it.
const MALFORMED_CITATION_PATTERN =
  /(（出典:|\(Source:)\s*(https?:\/\/[^\s()]+)\((https?:\/\/[^\s()]+)\)\)/g;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export class CitationFormatNormalizer implements ICitationFormatNormalizer {
  normalize(body: string): string {
    return body.replace(
      MALFORMED_CITATION_PATTERN,
      (_match, label: string, url1: string) => {
        const title = hostnameOf(url1);
        return label === "（出典:"
          ? `（出典: [${title}](${url1})）`
          : `(Source: [${title}](${url1}))`;
      },
    );
  }
}
