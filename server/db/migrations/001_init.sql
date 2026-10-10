-- 001_init.sql — Crumbbase greenfield schema (revamp P0).
-- Forward-only migrations. Conventions:
--   * ids are TEXT (uuid v4 generated in JS)
--   * timestamps are INTEGER unix milliseconds
--   * booleans are INTEGER 0/1
--   * blocks."position" (not "order" — reserved word) orders siblings
--   * FTS index (blocks_fts) is maintained EXPLICITLY by the repository layer
--     (see learncache refreshSearchIndex pattern), not by triggers.

CREATE TABLE IF NOT EXISTS sources (
  id              TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  canonical_url   TEXT NOT NULL UNIQUE,
  source_type     TEXT NOT NULL CHECK (source_type IN ('youtube', 'podcast', 'blog', 'book', 'unknown')),
  title           TEXT,
  creator         TEXT,
  duration_seconds INTEGER,
  thumbnail_url   TEXT,
  thumbnail_path  TEXT,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'fetching', 'awaiting_paste', 'processing', 'complete', 'failed')),
  error           TEXT,
  starred         INTEGER NOT NULL DEFAULT 0,
  last_opened_at  INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources (status, updated_at);

CREATE TABLE IF NOT EXISTS transcripts (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL UNIQUE REFERENCES sources (id) ON DELETE CASCADE,
  text          TEXT NOT NULL DEFAULT '',
  segments_json TEXT NOT NULL DEFAULT '[]',
  origin        TEXT NOT NULL DEFAULT 'caption'
                CHECK (origin IN ('caption', 'transcription', 'paste')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id         TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL UNIQUE REFERENCES sources (id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'Untitled',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id         TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES blocks (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  content    TEXT NOT NULL DEFAULT '',
  -- props_json: { kind: tldr|key-idea|claim|question|tag-note|transcript-chunk,
  --   timestamp: seconds|null, speaker, aliases: string[] }
  props_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks_page ON blocks (page_id, parent_id, position);

-- Backlinks / graph edges. Populated in P2 by [[link]] parsing.
CREATE TABLE IF NOT EXISTS links (
  id            TEXT PRIMARY KEY,
  from_block_id TEXT NOT NULL REFERENCES blocks (id) ON DELETE CASCADE,
  to_page_id    TEXT REFERENCES pages (id) ON DELETE CASCADE,
  to_block_id   TEXT REFERENCES blocks (id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  CHECK (to_page_id IS NOT NULL OR to_block_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_links_from ON links (from_block_id);
CREATE INDEX IF NOT EXISTS idx_links_to_page ON links (to_page_id);
CREATE INDEX IF NOT EXISTS idx_links_to_block ON links (to_block_id);

CREATE TABLE IF NOT EXISTS tags (
  block_id TEXT NOT NULL REFERENCES blocks (id) ON DELETE CASCADE,
  tag      TEXT NOT NULL,
  PRIMARY KEY (block_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag);

-- DB-backed job queue (SQLite port of the Mongo jobs pattern).
-- Worker polls: status IN ('queued','failed') AND next_run_at <= now.
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL
              CHECK (type IN ('ingest', 'structure', 'backup', 'link_index')),
  source_id   TEXT REFERENCES sources (id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER NOT NULL,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs (status, next_run_at);

CREATE TABLE IF NOT EXISTS processing_logs (
  id         TEXT PRIMARY KEY,
  source_id  TEXT REFERENCES sources (id) ON DELETE CASCADE,
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
  message    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_source ON processing_logs (source_id, created_at);

-- Daily review queue state (driven in P2).
CREATE TABLE IF NOT EXISTS review_state (
  page_id    TEXT PRIMARY KEY REFERENCES pages (id) ON DELETE CASCADE,
  first_seen INTEGER NOT NULL,
  opens      INTEGER NOT NULL DEFAULT 0,
  next_due   INTEGER,
  reason     TEXT
);

-- Full-text search over blocks. block_id is UNINDEXED (join key only).
CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
  block_id UNINDEXED,
  title,
  content,
  aliases,
  tokenize = 'porter'
);
