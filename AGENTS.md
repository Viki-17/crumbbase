# AGENTS.md — Crumbbase memory (revamp, started Oct 2026)

## Vision
Crumbbase = Logseq-style knowledge base fed by a learncache-style capture
pipeline. YouTube first; books/blogs later. Single user, hosted on own server,
browser-accessed.

## Locked decisions (do not relitigate without asking)
- **DB: SQLite** (`./data/crumbbase.db`, WAL, `better-sqlite3` + versioned SQL
  migrations). No Mongo, no RabbitMQ, no Ollama — all removed Oct 2026.
- **AI: OpenCode sidecar only** (`pro` heavy / `flash` light, both default to
  `opencode-go/muse-spark-1.3-contributor`, overridable via `OPENCODE_*_MODEL`).
  No embedding models in v1; semantic recall via FTS5 + AI-generated aliases.
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
- [x] **P0 Foundation** ✅ DONE — SQLite + migrations, zod config (`DATA_DIR`,
  transcript provider, `GITHUB_BACKUP_*`), setup/status (yt-dlp/ffmpeg, backup
  health), Markdown format spec.
- [ ] **P1 MVP: capture & revisit YouTube** ⏳ IN PROGRESS — capture API + canonical/dedupe
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
- better-sqlite3 repos are synchronous: they return values, not promises.
  `await` on them is harmless but `.catch()` chaining throws
  (`... .catch is not a function`) — guard with try/catch instead.
  Audited Oct 2026: worker tick was the only `.catch` offender.
- `fetch failed` from OpenCode calls = sidecar not running. It must be up
  (`opencode serve --port 4096 --hostname 127.0.0.1`) before any structure job
  runs; client error now names the URL. A `failed` source needs manual reset
  to `processing` + a fresh `structure` job (retries are exhausted).
- Mongoose buffers ops while disconnected: guard queue tick and endpoints with
  `mongoose.connection.readyState !== 1`. (Kept as a lesson for SQLite: never
  let a health endpoint hang on a down dependency.)

## Sessions
- Oct 2026 (revamp kickoff): replaced memory; removed Ollama dep + all
  embedding call sites (ask/auto-connect/suggest-links return 501 until P1/P2
  rebuilds them on FTS/LLM). P0 not started.
- Oct 2026 (P0 done): SQLite layer (`server/db/`: db.js WAL+FK, migrate runner,
  001_init.sql with 10 tables + blocks_fts), config gains DATA_DIR /
  TRANSCRIPT_PROVIDER / GITHUB_BACKUP_*, setup/status gains sqlite+tools+backup
  sections via `server/services/setup-checks.js`, Markdown mirror spec frozen
  (`server/db/MARKDOWN_FORMAT.md`), `/data/` gitignored. Verified: fresh
  migrate, round-trip, FTS alias search, FK enforcement, idempotency.
  Live boot/endpoint confirmation pending on user server (Atlas + yt-dlp).
- Oct 2026 (P1 cutover): deleted all Mongo surface (models/index.js, storage.js,
  Mongo jobs.js, rabbitmq.js, migrate-*.js scripts, old index.js routes, old
  worker handlers) + uninstalled mongoose/amqplib/uuid/multer. New shell:
  `server/index.js` (setup/status on sqlite, generic SSE `/api/events/:scope`,
  404 JSON), `server/worker.js` (SQLite poll + empty DISPATCH), `server/db/jobs.js`
  (SQLite queue/logs port). Config has no connection strings. Verified: local
  boot with zero external services, setup/status green, old routes 404,
  synthetic job queued→complete with warn log. Fixed `getLogsForSource(null)`
  (`IS` not `=`). Old React views will 404 until P1 rebuilds them.
- Oct 2026 (P1 capture+ingest): `server/lib/urls.js` (canonical/dedupe, YT
  shorts/embed/live + t= parse), `server/db/sources.js` repo,
  `POST /api/capture` (201 / 409 duplicate / 400) + sources list/detail/paste/
  delete, `server/handlers/ingest.js` (yt-dlp meta+captions, VTT parse with
  dupe-collapse, auto→awaiting_paste / yt-dlp→throw / paste→skip). Verified
  live: 400/409/paste flows green, real YouTube fetch (60 segments) works,
  cascades wipe clean. Structure handler + outline UI still to come.
- Oct 2026 (P1 structure): `server/db/pages.js` repo (blocks/tags/FTS/search),
  `server/services/mirror.js` (MARKDOWN_FORMAT writer + manifest),
  `server/handlers/structure.js` (pro generateJSON → zod → page replace +
  tagged/indexed blocks + mirror, final-attempt marks source failed).
  Verified offline with stubbed AI: 8 blocks, tag normalize, FTS alias hit,
  mirror sections/deep-links, idempotent replace, failure semantics, paste
  chunks carry no timestamps. Fixed mirror.js require paths (`../db/*`).
  Live AI run needs OpenCode sidecar (not running in sandbox).
- Oct 2026 (P1 backup): `server/handlers/backup.js` (`backup` jobs: debounce
  5min, init+remote+branch ensure, commit pages/assets/manifest, push, state;
  `.db*` + state never committed via `data/.gitignore`), wired in DISPATCH +
  structure completion + `POST /api/backup/run` (202). Verified live against
  real repo `Viki-17/crumbbase-backup` (SSH): push, excludes, state, debounce,
  remote cleaned; route→worker→skip path green. P1 stays open pending a
  real end-to-end on user server (sidecar AI + human UI pass).
- Oct 2026 (model switch): pro/flash now default to
  `opencode-go/muse-spark-1.3-contributor` (`OPENCODE_*_MODEL` overridable);
  client error names sidecar URL. Verified live via sidecar (1.9s JSON
  roundtrip). Failed source requeued → completed (20 blocks, 12 tags).
- Oct 2026 (P1 UI): backend `GET /api/pages/:id` (tree+source),
  `GET /api/search` (FTS+context, 400 if <2 chars), `PATCH /sources/:id`
  (star), list gains starred/sort=opened. Frontend rewritten: App shell +
  Library (capture bar+filters+cards) / SourceView (status pipeline, paste
  box, outline, transcript, logs, 3s poll) / SearchView + Outline renderer
  (kind sections, ts deep-links, collapsible transcript) + fresh index.css.
  Deleted all old book UI components/styles. Verified: vite build, live page/
  search/star/filter/404 flows, cascade wipe clean. Backup job still to come.
- Oct 2026 (P1 UI polish + cards): Library grid (thumbnail/avatar, TLDR
  snippet, top-3 tags, note count via `listSourcesWithPreview`/`getSourcePreview`;
  Starred checkbox → pill toggle), SourceView hero + sticky head + Outline/Cards/
  Focus toggle + Copy MD + clickable hero tags, Outline restyled (TLDR callout,
  idea/claim cards, question checklist, `stripHashtags` render fix, prominent
  ▶ timestamps, per-card copy), new `CardDeck.jsx` (visual Zettel preview, no DB
  change). `structure.js` stops baking `tagInline` into blocks (tags stay in
  tags table + mirror ## Tags). Atomize draft (manual, no auto-enqueue):
  `server/handlers/atomize.js` (zod schema, flash prompt, local sentence-split
  fallback ≤280 chars, idempotent `commitZettels` with links edges) +
  `GET/POST /sources/:id/zettels/preview|commit` + mirror `## Zettels` section +
  `✨ Make cards` button (AI draft w/ local fallback). Verified: vite build,
  syntax checks, local draft (3 cards, long→2 split), preview/commit
  idempotency + mirror sections on temp DATA_DIR.
- Oct 2026 (P2a search recall + P2b concepts): FTS now indexes tags in the
  aliases column (`indexBlock` gains `tags`), claims gain AI aliases + entity-
  aware alias rule, `searchBlocksWithContext` is AND-then-OR (exact first,
  `or` fills to limit) with `<mark>` snippets + `matchedTags` + per-block
  concepts, `scripts/reindex-fts.js` backfills old rows. Concepts layer:
  `003_concepts.sql` (concepts/concept_links/rejections; blocks cascade,
  concepts survive), `server/db/concepts.js` (autocreate+alias merge, content-
  match assignment 1.0/0.8, tag edges 0.6, `[[wikilink]]` parse, unlinked
  suggest via FTS AND, graph rollup), entities extracted in the same pro call
  (no extra latency) + `link_index` job (`handlers/concepts.js`, flash w/
  local fallback) for backfill via `POST /sources/:id/concepts/extract`,
  hybrid accept/reject endpoints, `GET /graph`, mirror `## Concepts`
  (export-only) + spec update. UI: Search groups by source w/ exact+related
  counts + why-matched chips, `[[concept]]` chips on all cards, Concepts list/
  detail (linked + unlinked accept/dismiss), bipartite Graph view, `Link
  concepts` button on old pages. Verified on scratch + real-DB copy + live:
  `palantir impact` → 1 exact + 9 related (tagged-only FDE idea found), link/
  accept/reject/graph/mirror green, reindex idempotent, live DB migrated +
  reindexed (157 blocks), vite build green. Sidecar confirmed up (link_index
  ran via flash).
- Oct 2026 (concept query expansion): OR pass widened with concept-alias words
  (`findConceptsForTokens`/`conceptAliasWords`, `GET /search` reports
  `expanded`), so acronyms coined after indexing still retrieve (`quuxrunner`
  test green, AND stays strict). Verified generic with made-up terms (Zeftron),
  client shows `via [[...]]`, vite build green.
- Oct 2026 (E1+E2+E3 smart entities): `004_concept_evidence.sql` (edge
  evidence, concept status provisional/established + first_seen, link_state
  fingerprint, concept_suggestions queue). E1: entities carry verbatim
  evidence sentences (schema+prompt+pass-through) + safety-net link_index when
  empty. E2: catalog-aware flash extraction (reuses existing names verbatim),
  evidence-anchored assignment (quote match 1.0, else name/alias/tag), edge
  evidence backfill, multi-source promotion, pre-AI fingerprint gate
  (`{refresh:true}` forces; manual button sends it). E3: sweep job (local
  promotion + flash-judged duplicate pairs by index ref → pending merge
  suggestions, never silent) every 3rd capture + manual Sweep button, Emerging
  radar, evidence shown on concept pages + chip tooltips, `[[*]]` marks
  provisional chips. Fixed pair-skip bug (alias overlap hid split rows) +
  name-match fragility (index refs). Verified live-AI end-to-end: evidence on
  edges, provisional→established, cached retry, merge accept absorbs loser as
  alias, sweep judged FDE-team distinct + Palantir-Tech same, 004 migrates
  real-DB copy cleanly, vite build green.
- Oct 2026 (sweep clarity): sweep reports `scanned{concepts,links}` and
  short-circuits with guidance when zero concepts exist (both live link_index
  jobs were sweeps over an empty table — per-page extraction never ran, so
  0/0/0 was correct, not a failure). Diagnosis: old pages need one Link
  concepts run; new captures auto-link in structure.
- Oct 2026 (mobile UI): bottom tab bar + static top brand bar ≤860px (sidebar
  hidden), 16px inputs (no iOS zoom), stacked capture bar, single-column grids,
  SourceView single-row sticky head (sticks to top:0, no gap sliver), compact
  hero row (92px thumb), 2-col action grid with subtle Delete, tags collapsed
  to 8 + show-all toggle, graph scrolls horizontally, toasts bottom-center
  above tab bar. Verified: vite build green.
- Oct 2026 (reading font): Libron v0.31 (OFL, self-hosted `client/public/fonts/
  libron/` + OFL.txt) for prose surfaces only (TLDR, card bodies, questions,
  snippets, transcript, evidence, library preview); UI chrome stays Inter.
  Unused Merriweather dropped from index.html. Verified: vite build green.