-- 007_drop_questions.sql — Follow-up questions section dropped Oct 2026.
-- Purges question blocks and their explicitly-maintained FTS rows (blocks_fts
-- is NOT FK-managed, so it goes first). tags / links / concept edges cascade
-- via FK (the migrating handle enforces foreign_keys=ON — see server/db/db.js).
-- Mirrors drop the section on their next rewrite; the importer ignores legacy
-- ## Follow-up questions sections, so hub sync converges without reintroducing
-- them. Idempotent: re-running deletes zero rows.
DELETE FROM blocks_fts WHERE block_id IN (SELECT id FROM blocks WHERE props_json LIKE '%"kind":"question"%');
DELETE FROM blocks WHERE props_json LIKE '%"kind":"question"%';
