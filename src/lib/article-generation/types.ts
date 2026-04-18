export interface ArticleSource {
  url: string;
  title?: string;
  type: "official" | "blog" | "other";
}

export interface GeneratedArticle {
  filename: string;
  content: string;
  metadata: {
    title: string;
    date: string;
    summary: string;
    trustLevel: "official" | "blog" | "speculative";
    tags: string[];
    sources: ArticleSource[];
    draft: boolean;
    lang: "ja" | "en";
  };
}

export interface RssEntry {
  source_label: string;
  source_url: string;
  title: string;
  link: string;
  summary: string;
  published_at: string;
}
