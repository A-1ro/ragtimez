-- Add profile fields to the users table.
-- These columns are nullable (default NULL) so existing rows are unaffected.
ALTER TABLE users ADD COLUMN github_url TEXT;
ALTER TABLE users ADD COLUMN x_url TEXT;
ALTER TABLE users ADD COLUMN linkedin_url TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
