export type Lang = "ja" | "en";

export const SUPPORTED_LANGS = ["ja", "en"] as const;
export const DEFAULT_LANG: Lang = "ja";

export const translations: Record<Lang, Record<string, string>> = {
  ja: {
    siteTagline: "AI-powered daily tech blog",
    backToList: "← 一覧に戻る",
    noArticles: "記事はまだありません。",
    articles: "記事",
    sources: "出典",
    trustOfficial: "公式",
    trustBlog: "ブログ",
    trustSpeculative: "推測",
    communityNotes: "コミュニティノート",
    newsletterEmailLabel: "メールアドレス",
    newsletterSubscribe: "購読する",
    languageSwitcherJa: "日本語",
    languageSwitcherEn: "English",
  },
  en: {
    siteTagline: "AI-powered daily tech blog",
    backToList: "← Back to list",
    noArticles: "No articles yet.",
    articles: "articles",
    sources: "Sources",
    trustOfficial: "Official",
    trustBlog: "Blog",
    trustSpeculative: "Speculative",
    communityNotes: "Community Notes",
    newsletterEmailLabel: "Email address",
    newsletterSubscribe: "Subscribe",
    languageSwitcherJa: "日本語",
    languageSwitcherEn: "English",
  },
};

export function t(lang: Lang, key: string): string {
  return translations[lang]?.[key] ?? translations.ja?.[key] ?? key;
}

export function isLang(value: string): value is Lang {
  return SUPPORTED_LANGS.includes(value as Lang);
}

export function getLangFromPath(pathname: string): Lang {
  if (pathname === "/en" || pathname.startsWith("/en/")) {
    return "en";
  }
  return "ja";
}

/**
 * Returns the Content Collection ID of the counterpart article in the other language.
 * - ja → en: appends ".en" (e.g. "2026-04-10" → "2026-04-10.en")
 * - en → ja: strips the ".en" suffix (e.g. "2026-04-10.en" → "2026-04-10")
 */
export function getCounterpartArticleId(id: string, currentLang: Lang): string {
  if (currentLang === "ja") {
    return `${id}.en`;
  }
  // en → ja: remove trailing ".en" if present (defensive: return as-is otherwise)
  if (id.endsWith(".en")) {
    return id.slice(0, -3);
  }
  return id;
}

export function localizePath(path: string, lang: Lang): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  if (lang === "ja") {
    // Remove /en prefix if present
    if (cleanPath === "/en" || cleanPath.startsWith("/en/")) {
      if (cleanPath === "/en") return "/";
      return cleanPath.slice(3);
    }
    return cleanPath;
  }

  // lang === "en"
  if (cleanPath === "/en" || cleanPath.startsWith("/en/")) {
    return cleanPath;
  }
  if (cleanPath === "/") {
    return "/en";
  }
  return `/en${cleanPath}`;
}
