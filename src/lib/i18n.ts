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
    // Notes API error messages
    noteErrMissingArticle: "クエリパラメータ「article」が必要です",
    noteErrDbUnavailable: "この環境ではDBバインディングを利用できません",
    noteErrInvalidJson: "リクエストボディのJSONが不正です",
    noteErrArticleRequired: "article_slug は必須です",
    noteErrArticleTooLong: "article_slug は200文字以内で入力してください",
    noteErrBodyRequired: "body は必須です（1文字以上）",
    noteErrBodyTooLong: "body は1000文字以内で入力してください",
    noteErrUnauthorized: "認証が必要です",
    noteErrForbidden: "この操作を行う権限がありません",
    noteErrNotFound: "ノートが見つかりません",
    noteErrIdRequired: "ノートIDが必要です",
    noteErrInternal: "内部サーバーエラーが発生しました",
    // Bookmark API error messages
    bookmarkErrUnauthorized: "認証が必要です",
    bookmarkErrDbUnavailable: "この環境ではDBバインディングを利用できません",
    bookmarkErrInvalidJson: "リクエストボディのJSONが不正です",
    bookmarkErrSlugRequired: "slug は必須です",
    bookmarkErrSlugTooLong: "slug は200文字以内で入力してください",
    bookmarkErrInternal: "内部サーバーエラーが発生しました",
    // Bookmark UI strings
    bookmarkAdd: "ブックマーク",
    bookmarkRemove: "ブックマーク解除",
    bookmarkLoginPrompt: "ログインしてブックマーク",
    bookmarksPageTitle: "ブックマーク",
    bookmarksEmpty: "ブックマークした記事はまだありません。",
    bookmarksBrowse: "記事を読む",
    bookmarksCount: "件の記事をブックマーク中",
    bookmarksArticleList: "ブックマーク記事一覧",
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
    // Notes API error messages
    noteErrMissingArticle: "Missing required query parameter: article",
    noteErrDbUnavailable: "DB binding is not available in this environment",
    noteErrInvalidJson: "Invalid JSON in request body",
    noteErrArticleRequired: "article_slug is required",
    noteErrArticleTooLong: "article_slug must not exceed 200 characters",
    noteErrBodyRequired: "body is required and must contain at least 1 character",
    noteErrBodyTooLong: "body must not exceed 1000 characters",
    noteErrUnauthorized: "Unauthorized: authentication required",
    noteErrForbidden: "Forbidden: you are not the author of this note",
    noteErrNotFound: "Note not found",
    noteErrIdRequired: "Note ID is required",
    noteErrInternal: "Internal server error",
    // Bookmark API error messages
    bookmarkErrUnauthorized: "Unauthorized: authentication required",
    bookmarkErrDbUnavailable: "DB binding is not available in this environment",
    bookmarkErrInvalidJson: "Invalid JSON in request body",
    bookmarkErrSlugRequired: "slug is required",
    bookmarkErrSlugTooLong: "slug must not exceed 200 characters",
    bookmarkErrInternal: "Internal server error",
    // Bookmark UI strings
    bookmarkAdd: "Bookmark",
    bookmarkRemove: "Remove bookmark",
    bookmarkLoginPrompt: "Login to bookmark",
    bookmarksPageTitle: "Bookmarks",
    bookmarksEmpty: "You have no bookmarked articles yet.",
    bookmarksBrowse: "Browse articles",
    bookmarksCount: "bookmarked",
    bookmarksArticleList: "Bookmarked articles",
  },
};

export function t(lang: Lang, key: string): string {
  return translations[lang]?.[key] ?? translations.ja?.[key] ?? key;
}

export function isLang(value: string): value is Lang {
  return SUPPORTED_LANGS.includes(value as Lang);
}

/**
 * Determines the response language for API routes.
 *
 * Priority:
 *   1. `?lang=ja|en` query parameter
 *   2. `Accept-Language` header (first tag: `en*` → "en", otherwise "ja")
 *   3. Default: "ja"
 */
export function getLangFromRequest(request: Request): Lang {
  const url = new URL(request.url);
  const langParam = url.searchParams.get("lang");
  if (langParam && isLang(langParam)) {
    return langParam;
  }

  const acceptLanguage = request.headers.get("Accept-Language") ?? "";
  // Parse the first language tag (e.g. "en-US,en;q=0.9,ja;q=0.8" → "en-US")
  const firstTag = acceptLanguage.split(",")[0]?.split(";")[0]?.trim() ?? "";
  if (firstTag.toLowerCase().startsWith("en")) {
    return "en";
  }

  return DEFAULT_LANG;
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
