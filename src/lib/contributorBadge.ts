/**
 * Contributor badge logic for community note authors.
 *
 * Ranks are determined by the total number of notes a user has posted.
 * Labels mix Japanese and English consistent with the project's existing style.
 */

/** Rank tier identifier. */
export type ContributorRank = "none" | "bronze" | "silver" | "gold";

/** Full badge descriptor including display properties. */
export interface ContributorBadge {
  /** Tier identifier. */
  rank: ContributorRank;
  /** Human-readable label shown in the UI. */
  label: string;
  /** CSS colour value for the badge. */
  color: string;
  /** Minimum note count required to achieve this rank. */
  minNotes: number;
}

/** Ordered badge definitions (excluding "none"). */
const BADGES: readonly ContributorBadge[] = [
  { rank: "gold",   label: "Contributor (Gold)",   color: "#ffd700", minNotes: 20 },
  { rank: "silver", label: "Contributor (Silver)", color: "#c0c0c0", minNotes: 5  },
  { rank: "bronze", label: "Contributor (Bronze)", color: "#cd7f32", minNotes: 1  },
] as const;

/**
 * Return the contributor rank for a given note count.
 *
 * Rules:
 *   0       → "none"
 *   1–4     → "bronze"
 *   5–19    → "silver"
 *   20+     → "gold"
 */
export function getContributorRank(noteCount: number): ContributorRank {
  if (noteCount >= 20) return "gold";
  if (noteCount >= 5)  return "silver";
  if (noteCount >= 1)  return "bronze";
  return "none";
}

/**
 * Return the full badge descriptor for a given note count, or `null` when
 * the user has not yet earned any rank (0 notes).
 */
export function getContributorBadge(noteCount: number): ContributorBadge | null {
  const rank = getContributorRank(noteCount);
  if (rank === "none") return null;
  return BADGES.find((b) => b.rank === rank) ?? null;
}
