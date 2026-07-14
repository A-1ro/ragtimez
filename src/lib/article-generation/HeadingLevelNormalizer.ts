import type { IHeadingLevelNormalizer } from "./interfaces";

export class HeadingLevelNormalizer implements IHeadingLevelNormalizer {
  normalize(body: string): string {
    const segments = body.split(/(```[\s\S]*?```)/g);
    return segments
      .map((segment, i) => {
        if (i % 2 === 1) return segment; // leave fenced code blocks untouched
        return segment.replace(/^#{3,6}(\s+.+)$/gm, "##$1");
      })
      .join("");
  }
}
