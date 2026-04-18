import { tavilyExtract, tavilySearch } from "../tavily";
import type {
  ExtractResult,
  ISearchProvider,
  SearchOptions,
  SearchResult,
} from "./interfaces";

export class TavilySearchProvider implements ISearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(queries: string[], options?: SearchOptions): Promise<SearchResult[]> {
    return tavilySearch(this.apiKey, queries, options);
  }

  async extract(urls: string[]): Promise<ExtractResult[]> {
    return tavilyExtract(this.apiKey, urls);
  }
}
