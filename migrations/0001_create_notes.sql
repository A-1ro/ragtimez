-- Create users table for storing GitHub user data
CREATE TABLE IF NOT EXISTS users (
  github_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create notes table for community notes on articles
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  article_slug TEXT NOT NULL,
  author_github_id TEXT NOT NULL REFERENCES users(github_id),
  author_username TEXT NOT NULL,
  author_avatar TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create index for efficient filtering notes by article
CREATE INDEX IF NOT EXISTS idx_notes_article_slug ON notes(article_slug);

-- Create index for efficient filtering notes by author
CREATE INDEX IF NOT EXISTS idx_notes_author_github_id ON notes(author_github_id);
