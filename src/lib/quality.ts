/**
 * Article quality scoring module.
 *
 * Computes a 0–100 quality score from four signals:
 *
 * 1. **Sources score** (0–35 pts)
 *    Uses a log-based diminishing-returns formula so adding a 10th source
 *    contributes far less than adding a 2nd:
 *      sources_score = min(35, 35 * log2(sourceCount + 1) / log2(9))
 *    A single source earns ~12 pts; 3 sources ~22 pts; 8+ sources ~35 pts.
 *
 * 2. **Official source ratio** (0–30 pts)
 *    officialRatio = officialSourceCount / max(sourceCount, 1)
 *    official_score = 30 * officialRatio
 *
 * 3. **Trust level base** (0–25 pts)
 *    official → 25 pts
 *    blog     → 15 pts
 *    speculative → 5 pts
 *
 * 4. **Community notes penalty** (0 to −NOTES_PENALTY_MAX pts)
 *    Each community note suggests a potential correction or issue was raised.
 *    The penalty is capped at NOTES_PENALTY_MAX pts:
 *      penalty = min(NOTES_PENALTY_MAX, noteCount * NOTES_PENALTY_PER_NOTE)
 *    (0 notes → 0 penalty; 5+ notes → NOTES_PENALTY_MAX pt penalty)
 *
 * Total = clamp(sources_score + official_score + trust_score − notes_penalty, 0, 100)
 *
 * Grade thresholds:
 *   A  ≥ 85
 *   B  ≥ 70
 *   C  ≥ 55
 *   D  < 55
 *
 * @example
 * // Official article with 5 sources (3 official), 0 notes:
 * //   sources_score  = 35 * log2(6) / log2(9) ≈ 35 * 2.585 / 3.170 ≈ 28.5
 * //   official_score = 30 * (3/5) = 18.0
 * //   trust_score    = 25 (official)
 * //   notes_penalty  = 0
 * //   total ≈ 72 → grade B
 * computeQualityScore({
 *   sourceCount: 5,
 *   officialSourceCount: 3,
 *   trustLevel: "official",
 *   noteCount: 0,
 * })
 * // → { score: 72, grade: "B", breakdown: { sources: 28.5, officialRatio: 18, trustLevel: 25, notesPenalty: 0, sourceCount: 5, officialSourceCount: 3 } }
 */

export type QualityInputs = {
  /** Total number of sources listed in the article. */
  sourceCount: number;
  /** Number of sources where type === "official". */
  officialSourceCount: number;
  /** Article-level trust classification. */
  trustLevel: "official" | "blog" | "speculative";
  /**
   * Number of community notes posted against this article.
   * Treated as a correction signal; higher counts apply a small penalty.
   * Defaults to 0 when omitted (e.g. when D1 is unavailable locally).
   */
  noteCount?: number;
};

export type QualityScore = {
  /** Composite score from 0 to 100 (higher is better). */
  score: number;
  /** Letter grade: A (≥85), B (≥70), C (≥55), D (<55). */
  grade: "A" | "B" | "C" | "D";
  breakdown: {
    /** Points from source count (0–35). */
    sources: number;
    /** Points from official source ratio (0–30). */
    officialRatio: number;
    /** Points from article trust level (5, 15, or 25). */
    trustLevel: number;
    /** Penalty from community notes (0–10). */
    notesPenalty: number;
    /** Total number of sources listed in the article. */
    sourceCount: number;
    /** Number of sources where type === "official". */
    officialSourceCount: number;
  };
};

/** Map trust level to its base point value. */
const TRUST_POINTS: Record<"official" | "blog" | "speculative", number> = {
  official: 25,
  blog: 15,
  speculative: 5,
};

/** Points deducted per community note. */
const NOTES_PENALTY_PER_NOTE = 2;

/** Maximum total penalty that community notes can apply. */
const NOTES_PENALTY_MAX = 10;

/**
 * Grade badge colour map — maps each letter grade to its hex colour.
 * Exported so UI components share a single source of truth.
 */
export const GRADE_COLORS: Record<QualityScore["grade"], string> = {
  A: "#22c55e",
  B: "#3d8ef5",
  C: "#f59e0b",
  D: "#ef4444",
};

/**
 * Compute a quality score for an article given raw numeric inputs.
 *
 * All sub-scores are rounded to one decimal place before summing; the
 * final composite score is clamped to [0, 100] and rounded to a whole
 * number.
 */
export function computeQualityScore(inputs: QualityInputs): QualityScore {
  const { sourceCount, officialSourceCount, trustLevel, noteCount = 0 } = inputs;

  // --- 1. Source count score (log2 diminishing returns, max 35) ---
  // log2(1) = 0 so a zero-source article gets 0 pts.
  const sourcesRaw =
    sourceCount > 0
      ? Math.min(35, (35 * Math.log2(sourceCount + 1)) / Math.log2(9))
      : 0;
  const sourcesScore = Math.round(sourcesRaw * 10) / 10;

  // --- 2. Official ratio score (max 30) ---
  const officialRatio = sourceCount > 0 ? officialSourceCount / sourceCount : 0;
  const officialRatioScore = Math.round(30 * officialRatio * 10) / 10;

  // --- 3. Trust level score ---
  const trustScore = TRUST_POINTS[trustLevel];

  // --- 4. Notes penalty (capped at NOTES_PENALTY_MAX) ---
  const notesPenalty = Math.min(NOTES_PENALTY_MAX, noteCount * NOTES_PENALTY_PER_NOTE);

  // --- Composite ---
  const raw = sourcesScore + officialRatioScore + trustScore - notesPenalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const grade: QualityScore["grade"] =
    score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";

  return {
    score,
    grade,
    breakdown: {
      sources: sourcesScore,
      officialRatio: officialRatioScore,
      trustLevel: trustScore,
      notesPenalty,
      sourceCount,
      officialSourceCount,
    },
  };
}

/**
 * Convenience helper that extracts quality inputs directly from an article's
 * data object (as typed by Astro Content Collections) plus an optional note
 * count fetched separately from D1.
 *
 * @param article - Object with `sources` array and `trustLevel` field.
 * @param noteCount - Community notes count from D1 (omit or pass 0 when unavailable).
 */
export function computeArticleQualityFromData(
  article: {
    sources: Array<{ type?: "official" | "blog" | "other" }>;
    trustLevel: "official" | "blog" | "speculative";
  },
  noteCount?: number
): QualityScore {
  const sourceCount = article.sources.length;
  const officialSourceCount = article.sources.filter(
    (s) => s.type === "official"
  ).length;

  return computeQualityScore({
    sourceCount,
    officialSourceCount,
    trustLevel: article.trustLevel,
    noteCount,
  });
}
