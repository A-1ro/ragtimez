import type { IHeadingStructureValidator } from "./interfaces";

/**
 * Flattens "### " sub-headings into top-level "## " sections.
 *
 * DraftGenerator's prompt explicitly forbids nesting ### sub-sections under a single
 * ## wrapper section (HEADING LEVEL RULE, reinforced by self-review CHECK 5), but the
 * model still emits this structure occasionally — the rule and its own self-review are
 * both text the model can skip under load, with no deterministic backstop enforcing
 * them (unlike citations or empty sections, which PostProcessor already repairs
 * mechanically). This pass closes that gap: every "### " heading outside a fenced code
 * block is promoted to "## ", turning a nested wrapper structure into the flat one the
 * prompt requires, without calling the LLM again.
 *
 * Fenced code blocks are left untouched so a Markdown example inside a ``` block
 * (e.g. showing "### Heading" as sample output) is never rewritten.
 */
export class HeadingStructureValidator implements IHeadingStructureValidator {
  validate(body: string): string {
    const segments = body.split(/(```[\s\S]*?```)/g);
    let promoted = 0;
    const result = segments
      .map((segment, i) => {
        if (i % 2 === 1) return segment;
        return segment.replace(/^###\s+/gm, () => {
          promoted++;
          return "## ";
        });
      })
      .join("");

    if (promoted > 0) {
      console.warn(`見出し構造修復: ### 見出し ${promoted} 件を ## に昇格しました`);
    }

    return result;
  }
}
