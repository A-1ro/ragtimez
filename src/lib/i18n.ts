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
