-- Migration: 0005_add_bookmarks
-- Adds per-user article bookmarks (idempotent via INSERT OR IGNORE).

CREATE TABLE IF NOT EXISTS bookmarks (
  user_github_id TEXT NOT NULL REFERENCES users(github_id) ON DELETE CASCADE,
  article_slug   TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_github_id, article_slug)
);

-- Speeds up listing bookmarks for a single user.
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_github_id);
