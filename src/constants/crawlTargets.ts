/**
 * RSS feed sources for article generation.
 *
 * These URLs are fetched daily by /api/fetch-rss and stored in D1 for use by
 * the LLM article generation pipeline. Each source includes both the site root
 * URL and the RSS feed URL.
 */

export interface CrawlTarget {
  /** Human-readable label shown in the UI / logs */
  label: string;
  /** Root URL for reference */
  url: string;
  /** RSS feed URL to fetch */
  rssUrl: string;
  /** Optional: additional description used when displaying results */
  description?: string;
}

export const CRAWL_TARGETS: CrawlTarget[] = [
  {
    label: "Microsoft Azure Blog",
    url: "https://azure.microsoft.com/en-us/blog/",
    rssUrl: "https://azure.microsoft.com/en-us/blog/feed/",
    description: "Official Microsoft Azure product and engineering blog",
  },
  {
    label: "Azure Updates",
    url: "https://azure.microsoft.com/en-us/updates/",
    rssUrl: "https://azure.microsoft.com/en-us/updates/feed/",
    description: "Latest Azure service announcements and GA releases",
  },
  {
    label: "OpenAI Blog",
    url: "https://openai.com/news/",
    rssUrl: "https://openai.com/news/rss.xml",
    description: "Research and product updates from OpenAI",
  },
  {
    label: "Anthropic Blog",
    url: "https://www.anthropic.com/news",
    rssUrl: "https://www.anthropic.com/rss.xml",
    description: "Research, safety, and product news from Anthropic",
  },
  {
    label: "LangChain Blog",
    url: "https://blog.langchain.dev/",
    rssUrl: "https://blog.langchain.dev/rss/",
    description: "Tutorials, releases, and use-cases for LangChain / LangGraph",
  },
  {
    label: "Microsoft Learn – What's New",
    url: "https://learn.microsoft.com/en-us/azure/whats-new/",
    rssUrl: "https://learn.microsoft.com/en-us/azure/whats-new/feed/",
    description: "Microsoft Learn documentation updates for Azure services",
  },
  {
    label: "Hugging Face Blog",
    url: "https://huggingface.co/blog",
    rssUrl: "https://huggingface.co/blog/feed.xml",
    description: "Open-source ML models, datasets, and ecosystem news",
  },
  {
    label: "Google DeepMind Blog",
    url: "https://deepmind.google/discover/blog/",
    rssUrl: "https://deepmind.google/blog/rss.xml",
    description: "Research breakthroughs and model releases from DeepMind",
  },
  {
    label: "AWS Machine Learning Blog",
    url: "https://aws.amazon.com/blogs/machine-learning/",
    rssUrl: "https://aws.amazon.com/blogs/machine-learning/feed/",
    description: "AWS ML service announcements and best-practice guides",
  },
  {
    label: "Meta AI Blog",
    url: "https://ai.meta.com/blog/",
    rssUrl: "https://ai.meta.com/blog/rss.xml",
    description: "AI research and product updates from Meta",
  },
];
