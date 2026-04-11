import { t, type Lang } from "../lib/i18n";

export const trustLabelMap: Record<string, { label: string; color: string }> = {
  official: { label: "公式", color: "#22c55e" },
  blog: { label: "ブログ", color: "#f59e0b" },
  speculative: { label: "推測", color: "#ef4444" },
};

export function getTrustLabel(
  level: "official" | "blog" | "speculative",
  lang: Lang,
): string {
  const trustKeyMap: Record<"official" | "blog" | "speculative", string> = {
    official: "trustOfficial",
    blog: "trustBlog",
    speculative: "trustSpeculative",
  };
  return t(lang, trustKeyMap[level]);
}

export function getTrustColor(
  level: "official" | "blog" | "speculative",
): string {
  return trustLabelMap[level]?.color ?? "#6b7db3";
}
