# AGENTS.md — Project Book memory

## What this project is
"Project Book" (internal name: Crumbbase) — processes PDF books, YouTube transcripts, and blog text into chapter overviews, atomic notes (Zettelkasten-style), an overall book analysis, a knowledge graph, AI-organized folders, and text-to-speech audio.

## Stack
- **Backend**: Node.js + Express 5 (CommonJS), `server/index.js` (single-file API router, ~990 lines).
- **DB**: MongoDB via Mongoose 9. Schemas in `server/models/index.js` (Book, Chapter, Summary, Note, Analysis, Graph, Folder). All entities use custom `id` (uuid) + `type` fields rather than Mongo `_id`.
- **Queue**: RabbitMQ (`server/services/rabbitmq.js`) — jobs queue `ai.jobs.v2`, events queue `ai.events`. Worker runs in the SAME process as the API (imported in `server/index.js`), not separate.
- **AI**: OpenCode server (sidecar `opencode serve --port 4096`), called via `@opencode-ai/sdk` (ESM-only, loaded via dynamic `import()` from CJS). Wrapper is `server/services/opencode-client.js` (exports `generate`/`generateJSON`, model keys `pro`/`flash`). Models:
  - `pro` = `opencode-go/deepseek-v4-pro` → heavy: chapter overview, atomic notes, overall analysis, folder taxonomy/batch-assign.
  - `flash` = `opencode-go/deepseek-v4-flash` → light: link explanation, link suggestions, "Ask AI" RAG answer.
  - Auth inherited from `~/.local/share/opencode/auth.json` (opencode-go login); no app API key. `OPENCODE_SERVER_URL` env var (default `http://127.0.0.1:4096`).
- **Embeddings**: Ollama `nomic-embed-text` (kept — the only remaining Ollama usage for LLM/embeddings). Vector store is a naive in-memory cosine scan over all Note embeddings in `server/services/vector-store.js` (not a real vector DB). `POST /notes/ask` is now RAG: embed query → `findSimilar` top 8 → `aiService.answerQuestion` (flash) → returns `{ answer, sources }`.
- **Frontend**: React 19 + Vite, `client/`. Single-page app with view state in `App.jsx` (views: home, book, note, notes, graph, folders). Uses `react-force-graph-2d`, `lucide-react`, `react-hot-toast`, `react-markdown`. Axios `baseURL: /api`, proxied in dev via `client/vite.config.js` to `localhost:3001`.

## Key flows
1. `POST /api/books` (multipart PDF OR transcript JSON) → creates Book + Chapters (`splitIntoChapters`) → publishes per-chapter `overview` jobs.
2. Worker `processJob`: `overview` → `notes` (chained, overview triggers notes) → `book_analysis` (triggered after each chapter finalizes; only runs when all chapters done unless `force`).
3. SSE: `GET /api/books/:id/events` and `/api/folders/events`. Events are published to RabbitMQ and broadcast to connected SSE clients via `broadcast()` in `server/index.js`.
4. Graph: notes auto-synced to a singleton Graph doc. Manual/auto/AI links; `POST /api/graph/auto-connect` runs synchronously after responding (heavy).
5. Folders: `POST /api/folders/generate` queues `folder_organize`; two-step (generate taxonomy, then batch-assign notes, 20/batch) in `ai-service.js`.

## Important quirks / gotchas
- `server/index.js` has dead/duplicated code: `processBookWithChunks` comment-outs the initial job publish loop (line ~875), and there are unused `runTranscriptPipeline` / `runFullPipeline` helpers.
- Chapter splitting is heuristic in `pdf-processor.js`: official PDF outline → regex ToC → regex headers → size fallback (15k chars, 500 overlap). PDFs parse via `pdfjs-dist` + `@napi-rs/canvas` polyfills in `pdf-structure.js`.
- TTS is hybrid (`tts-service.js`): macOS uses native `say`; Linux uses local Piper binary (excluded from git via `.gitignore`). Audio cached by md5 hash in `server/uploads/audio/`.
- Book status enum in schema is `["processing","done","error"]` but worker/API also set `analysis_failed` (not in enum; Mongoose ignores by default, but watch for consistency).
- No auth, no tests (`npm test` prints "no test specified"), no TypeScript, no lint config on server side.

## Useful commands
- `npm run dev` — runs server + client via concurrently (server on 3001, client on 5173).
- `npm start` / `npm run server` — server only.
- `npm run client` — client only (cd client && npm run dev).
- `npm run stop` — kills ports 3000/3001/5173/5174.
- `opencode serve --port 4096 --hostname 127.0.0.1` — AI sidecar (PM2 app `crumbbase-opencode`). Must run as your user so it can read `~/.local/share/opencode/auth.json`.
- `cd client && npm run lint` — client ESLint only (has pre-existing errors/warnings).
- Env vars (`.env`): `PORT`, `MONGODB_URI`, `OLLAMA_HOST`, `OPENCODE_SERVER_URL`. RabbitMQ defaults to `amqp://127.0.0.1`.

## Deployment
PM2 via `ecosystem.config.js` (apps `crumbbase-api`, `crumbbase-client`), scripts `setup.sh` / `start.sh`. Nginx needs `client_max_body_size 50M`.
