-- 004_concept_evidence.sql — evidence-anchored edges + provisional lifecycle (P2).
-- concept_links.evidence stores the verbatim sentence the edge came from (E1),
-- shown in the UI as "why this links". concepts.status gates novelty:
-- provisional (seen once / AI-new) → established (2+ sources or accepted).
-- link_state fingerprints page inputs so link_index reruns are free no-ops.

ALTER TABLE concept_links ADD COLUMN evidence TEXT DEFAULT NULL;

ALTER TABLE concepts ADD COLUMN status TEXT NOT NULL DEFAULT 'established'
  CHECK (status IN ('provisional', 'established'));
ALTER TABLE concepts ADD COLUMN first_seen INTEGER DEFAULT NULL;

CREATE TABLE IF NOT EXISTS link_state (
  page_id       TEXT PRIMARY KEY REFERENCES pages (id) ON DELETE CASCADE,
  fingerprint   TEXT NOT NULL,
  links_written INTEGER NOT NULL DEFAULT 0,
  ran_at        INTEGER NOT NULL
);

-- Hybrid review queue (E3 sweep output, merge suggestions): never silent.
-- kind='alias': payload {alias} → append to concept.aliases.
-- kind='merge': payload {from_concept_id} → move loser's edges/aliases to winner.
CREATE TABLE IF NOT EXISTS concept_suggestions (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('alias', 'merge')),
  concept_id   TEXT NOT NULL REFERENCES concepts (id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  reason       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON concept_suggestions (status, created_at);
