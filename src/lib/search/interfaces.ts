export interface SearchResult {
  url: string;
  title: string;
  content: string;
  score: number;
}

export interface ExtractResult {
  url: string;
  raw_content: string;
}

export interface SearchOptions {
  search_depth?: "basic" | "advanced";
  include_domains?: string[];
}

export interface ISearchProvider {
  search(queries: string[], options?: SearchOptions): Promise<SearchResult[]>;
  extract(urls: string[]): Promise<ExtractResult[]>;
}
