import type { Lang } from "../lib/i18n";

export function formatDate(date: Date, lang: Lang = "ja"): string {
  const locale = lang === "en" ? "en-US" : "ja-JP";
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
