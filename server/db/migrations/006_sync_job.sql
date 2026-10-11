-- 006_sync_job.sql — allow the `sync` job type (P2 manual hub sync).
-- SQLite cannot ALTER a CHECK constraint, so the jobs table is rebuilt with
-- the widened type list. Data is carried over verbatim inside the migration
-- transaction (the runner wraps each file atomically).

CREATE TABLE jobs_new (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL
                CHECK (type IN ('ingest', 'structure', 'backup', 'link_index', 'sync')),
  source_id     TEXT REFERENCES sources (id) ON DELETE CASCADE,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_run_at   INTEGER NOT NULL,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

INSERT INTO jobs_new (id, type, source_id, payload_json, status, attempts,
  next_run_at, error, created_at, updated_at)
SELECT id, type, source_id, payload_json, status, attempts,
  next_run_at, error, created_at, updated_at FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;
CREATE INDEX idx_jobs_due ON jobs (status, next_run_at);
