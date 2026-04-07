/**
 * Cloudflare AI Search – crawl target sites.
 *
 * These URLs are registered as crawl targets via the Cloudflare AI Search API
 * (see scripts/setup-ai-search.ts).  AI Search periodically fetches and indexes
 * each site so that Workers can query the content through the AI_SEARCH binding.
 */

export interface CrawlTarget {
  /** Human-readable label shown in the UI / logs */
  label: string;
  /** Root URL submitted to AI Search for crawling */
  url: string;
  /** Optional: additional description used when displaying results */
  description?: string;
}

export const CRAWL_TARGETS: CrawlTarget[] = [
  {
    label: "Microsoft Azure Blog",
    url: "https://azure.microsoft.com/en-us/blog/",
    description: "Official Microsoft Azure product and engineering blog",
  },
  {
    label: "Azure Updates",
    url: "https://azure.microsoft.com/en-us/updates/",
    description: "Latest Azure service announcements and GA releases",
  },
  {
    label: "OpenAI Blog",
    url: "https://openai.com/news/",
    description: "Research and product updates from OpenAI",
  },
  {
    label: "Anthropic Blog",
    url: "https://www.anthropic.com/news",
    description: "Research, safety, and product news from Anthropic",
  },
  {
    label: "LangChain Blog",
    url: "https://blog.langchain.dev/",
    description: "Tutorials, releases, and use-cases for LangChain / LangGraph",
  },
  {
    label: "Microsoft Learn – What's New",
    url: "https://learn.microsoft.com/en-us/azure/whats-new/",
    description: "Microsoft Learn documentation updates for Azure services",
  },
  {
    label: "Hugging Face Blog",
    url: "https://huggingface.co/blog",
    description: "Open-source ML models, datasets, and ecosystem news",
  },
  {
    label: "Google DeepMind Blog",
    url: "https://deepmind.google/discover/blog/",
    description: "Research breakthroughs and model releases from DeepMind",
  },
  {
    label: "AWS Machine Learning Blog",
    url: "https://aws.amazon.com/blogs/machine-learning/",
    description: "AWS ML service announcements and best-practice guides",
  },
  {
    label: "Meta AI Blog",
    url: "https://ai.meta.com/blog/",
    description: "AI research and product updates from Meta",
  },
];
