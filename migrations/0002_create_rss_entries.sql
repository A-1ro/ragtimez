-- Create rss_entries table for storing fetched RSS feed items
CREATE TABLE IF NOT EXISTS rss_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_label TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL UNIQUE,
  summary TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for efficient queries on published date (for recent entries retrieval)
CREATE INDEX IF NOT EXISTS idx_rss_entries_published_at ON rss_entries(published_at);

-- Index for efficient filtering by source URL
CREATE INDEX IF NOT EXISTS idx_rss_entries_source_url ON rss_entries(source_url);
