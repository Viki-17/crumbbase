# AGENTS.md — Crumbbase memory (revamp, started Oct 2026)

## Vision
Crumbbase = Logseq-style knowledge base fed by a learncache-style capture
pipeline. YouTube first; books/blogs later. Single user, hosted on own server,
browser-accessed.

## Locked decisions (do not relitigate without asking)
- **DB: SQLite** (`./data/crumbbase.db`, WAL, `better-sqlite3` + versioned SQL
  migrations). No Mongo, no RabbitMQ, no Ollama — all removed Oct 2026.
- **AI: OpenCode sidecar only** (`pro` heavy / `flash` light). No embedding
  models in v1; semantic recall via FTS5 + AI-generated search aliases.
- **Safe copy: Markdown mirror + git push** to private GitHub repo
  (`./data/pages/*.md` + assets + `manifest.json`). Never commit the `.db`.
  Frontmatter carries block ids so the mirror is reimportable.
- **Transcripts: auto-fetch primary, paste fallback first-class**
  (`awaiting_paste` is a designed state, not an error).
- **Editing: read + annotate now; parent/child block tree underneath** so full
  outliner editing is a later UI upgrade, not a remodel.

## Schema (greenfield, old Mongo collections were deleted Oct 2026)
`sources(canonical_url UNIQUE) → transcripts → pages → blocks(parent_id, order,
props_json) + links(from_block→to_page/block) + tags + jobs + processing_logs
+ review_state`. No embedding columns (door open: `note_embeddings` later).

## Phases (update checkboxes every session)
- [ ] **P0 Foundation** — SQLite + migrations, zod config (`DATA_DIR`,
  transcript provider, `GITHUB_BACKUP_*`), setup/status (yt-dlp/ffmpeg, backup
  health), Markdown format spec.
- [ ] **P1 MVP: capture & revisit YouTube** — capture API + canonical/dedupe
  (409 duplicate) + yt-dlp ingest + paste fallback + AI structure
  (tldr/key-ideas/claims/questions/tags/aliases) + page/blocks outline UI +
  FTS5 search + recents/favorites + SSE + git auto-backup.
- [ ] **P2 Web of notes** — `[[link]]` parse + backlinks panel, graph from
  `links`, timestamp deep-links, daily review queue + daily-journal page.
- [ ] **P3 Breadth & polish** — PDF/book + blog ingest, AI folders, ZIP export,
  extension/PWA share, password auth, TTS re-wire.

## Session discipline
- Keep exactly one phase `in_progress`; mark done only when verified running.
- Update this file at session end: phase status, new decisions, new gotchas.
- Infra: Node + SQLite + `opencode serve :4096` + yt-dlp/ffmpeg + git.
  No brokers, no Atlas, no whitelist pain.

## Gotchas log
- Mongoose buffers ops while disconnected: guard queue tick and endpoints with
  `mongoose.connection.readyState !== 1`. (Kept as a lesson for SQLite: never
  let a health endpoint hang on a down dependency.)

## Sessions
- Oct 2026 (revamp kickoff): replaced memory; removed Ollama dep + all
  embedding call sites (ask/auto-connect/suggest-links return 501 until P1/P2
  rebuilds them on FTS/LLM). P0 not started.
