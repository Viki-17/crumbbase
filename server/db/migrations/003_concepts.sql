-- 003_concepts.sql — concept/entity layer (P2 Web of notes).
-- Concepts ("Palantir", "forward deployed engineer") are Logseq-style pages:
-- autocreated on first mention, shared across sources, aliased. Edges live in
-- concept_links (block → concept). Blocks cascade (attached cards die with
-- their source); concepts survive (independent knowledge). Rejections remember
-- "not this" so the hybrid suggest queue never re-offers a dismissed edge.

CREATE TABLE IF NOT EXISTS concepts (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  name_norm    TEXT NOT NULL UNIQUE,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_concepts_name ON concepts (name_norm);

CREATE TABLE IF NOT EXISTS concept_links (
  block_id   TEXT NOT NULL REFERENCES blocks (id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts (id) ON DELETE CASCADE,
  confidence REAL NOT NULL DEFAULT 1.0,
  origin     TEXT NOT NULL DEFAULT 'ai'
             CHECK (origin IN ('ai', 'wikilink', 'tag', 'manual', 'accepted')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (block_id, concept_id)
);
CREATE INDEX IF NOT EXISTS idx_concept_links_concept ON concept_links (concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_links_block ON concept_links (block_id);

CREATE TABLE IF NOT EXISTS concept_rejections (
  block_id   TEXT NOT NULL REFERENCES blocks (id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (block_id, concept_id)
);
