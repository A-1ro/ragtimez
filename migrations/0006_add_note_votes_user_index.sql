-- Migration: 0006_add_note_votes_user_index
-- Adds composite index on (user_github_id, created_at) to speed up
-- per-user rate-limit COUNT queries in the helpful vote endpoint.

CREATE INDEX IF NOT EXISTS idx_note_votes_user_created_at ON note_votes(user_github_id, created_at);
