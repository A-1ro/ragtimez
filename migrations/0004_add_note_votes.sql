-- Migration: 0004_add_note_votes
-- Adds per-note voting (one vote per user, idempotent via INSERT OR IGNORE).

CREATE TABLE IF NOT EXISTS note_votes (
  note_id        TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_github_id TEXT NOT NULL REFERENCES users(github_id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (note_id, user_github_id)
);

-- Speeds up COUNT(*) queries scoped to a single note.
CREATE INDEX IF NOT EXISTS idx_note_votes_note_id ON note_votes(note_id);
