// Crumbbase API shell (revamp P1 cutover).
// SQLite is the only database. Old Mongo routes (books/chapters/notes/graph/
// folders/links/upload) are deleted; P1 re-adds endpoints on the new schema:
// capture, sources, pages/blocks, search, review, backup. Unknown /api paths
// return 410-style 404 JSON so the old UI visibly reports instead of hanging.
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");

const { config } = require("./config");
const events = require("./services/events");
const setupChecks = require("./services/setup-checks");
const sqliteJobs = require("./db/jobs");
const worker = require("./worker"); // same-process worker (polls SQLite jobs)

const app = express();
const PORT = config.port;
const API_BASE = "/api";

app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// --- SSE fan-out (in-process; worker publishes, browsers subscribe per scope) ---
const clients = {}; // scope -> [res]
function broadcast(scope, data) {
  const bucket = clients[scope || "global"];
  if (!bucket) return;
  for (const client of bucket) {
    try {
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // slow/dead client; pruned on close
    }
  }
}

events.consumeEvents((event) => {
  const scope = event.sourceId || event.bookId || "global";
  broadcast(scope, event);
  if (scope !== "global") broadcast("global", event);
});

// Start worker (SQLite poll loop; no external services required to boot)
worker.startWorker().catch(console.error);

// --- API ---
const router = express.Router();

// Per-scope event stream: /api/events/<sourceId|global>
router.get("/events/:scope", (req, res) => {
  const scope = req.params.scope || "global";
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  if (!clients[scope]) clients[scope] = [];
  clients[scope].push(res);
  req.on("close", () => {
    clients[scope] = (clients[scope] || []).filter((c) => c !== res);
  });
});

// Readiness: every dependency P1 needs, in one checklist.
router.get("/setup/status", async (req, res) => {
  const sqliteStatus = setupChecks.sqliteStatus();
  let queue = null;
  try {
    queue = sqliteJobs.getQueueDepth();
  } catch {
    queue = null;
  }

  const uploadsDir = path.resolve(__dirname, "uploads");
  const piperBin = path.resolve(__dirname, "piper", "piper");
  let uploadsWritable = false;
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.accessSync(uploadsDir, fs.constants.W_OK);
    uploadsWritable = true;
  } catch {
    uploadsWritable = false;
  }

  async function reachable(url) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return true;
    } catch {
      return false;
    }
  }

  res.json({
    runtime: "sqlite",
    dataDir: { path: sqliteStatus.path, writable: sqliteStatus.dataDirWritable },
    sqlite: sqliteStatus,
    tools: setupChecks.toolsStatus(),
    backup: setupChecks.backupStatus(),
    ai: {
      opencodeServerUrl: config.opencodeServerUrl,
      opencodeReachable: await reachable(config.opencodeServerUrl),
    },
    queue,
    uploadsDir: { path: uploadsDir, writable: uploadsWritable },
    tts: {
      platform: process.platform,
      available: process.platform === "darwin" ? true : fs.existsSync(piperBin),
    },
  });
});

// P1 endpoints land here: POST /capture, GET /sources, /pages, /search, ...

// --- Capture (revamp P1) ---
const { normalizeCaptureUrl } = require("./lib/urls");
const sourcesRepo = require("./db/sources");

const SOURCE_TYPE_HINTS = new Set(["youtube", "podcast", "blog", "book", "unknown"]);

// POST /api/capture { url, sourceType? } → 201 {source, duplicate:false}
// or 409 {error, source} when the canonical URL already exists.
router.post("/capture", async (req, res) => {
  try {
    const normalized = normalizeCaptureUrl(req.body && req.body.url);
    let sourceType = normalized.sourceType;
    const hint = req.body && req.body.sourceType;
    // Explicit hints only ever specialize unknowns (blog/book have no URL signature).
    if (hint && SOURCE_TYPE_HINTS.has(hint) && sourceType === "unknown") {
      sourceType = hint;
    }
    const existing = sourcesRepo.findByCanonicalUrl(normalized.canonicalUrl);
    if (existing) {
      return res.status(409).json({ error: "Already captured.", source: existing, duplicate: true });
    }
    const source = sourcesRepo.createSource({
      url: normalized.originalUrl,
      canonicalUrl: normalized.canonicalUrl,
      sourceType,
    });
    sqliteJobs.enqueueJob({ type: "ingest", sourceId: source.id, payload: {} });
    events.publishEvent({ type: "sourceQueued", sourceId: source.id });
    res.status(201).json({ source, duplicate: false });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : String(err) });
  }
});

router.get("/sources", (req, res) => {
  try {
    const sources = sourcesRepo.listSourcesWithPreview({
      status: req.query.status,
      sourceType: req.query.source,
      starred: req.query.starred,
      sort: req.query.sort,
      query: req.query.q,
      limit: req.query.limit,
    });
    res.json({ sources });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

router.get("/sources/:id", (req, res) => {
  const detail = sourcesRepo.getSourceDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: "Source not found." });
  sourcesRepo.touchOpened(req.params.id);
  res.json(detail);
});

// Manual transcript fallback: stores pasted text and resumes the pipeline.
router.post("/sources/:id/paste", (req, res) => {
  const source = sourcesRepo.getSource(req.params.id);
  if (!source) return res.status(404).json({ error: "Source not found." });
  const text = String((req.body && req.body.text) || "").trim();
  if (text.length < 20) {
    return res.status(400).json({ error: "Pasted transcript is too short (min 20 characters)." });
  }
  const paragraphs = text.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
  const segments = paragraphs.map((p, i) => ({ start: i, end: i + 1, text: p }));
  sourcesRepo.upsertTranscript({ sourceId: source.id, text, segments, origin: "paste" });
  sourcesRepo.updateSource(source.id, { status: "processing", error: null });
  sqliteJobs.enqueueJob({ type: "structure", sourceId: source.id, payload: {} });
  events.publishEvent({ type: "sourceStatus", sourceId: source.id, status: "processing" });
  res.json({ ok: true, source: sourcesRepo.getSource(source.id) });
});

router.delete("/sources/:id", (req, res) => {
  const source = sourcesRepo.getSource(req.params.id);
  if (!source) return res.status(404).json({ error: "Source not found." });
  sourcesRepo.deleteSource(req.params.id);
  res.json({ deleted: true });
});

// Manual backup trigger: bypasses the daily gate (still skips the push when
// the mirror is unchanged). The structure step also enqueues one per page,
// and the worker self-schedules a daily check — all funnel through the same
// at-most-once-a-day, push-only-on-change policy in handlers/backup.js.
router.post("/backup/run", (req, res) => {
  const job = sqliteJobs.enqueueJob({ type: "backup", sourceId: null, payload: { manual: true } });
  res.status(202).json({ queued: true, jobId: job.id });
});

router.patch("/sources/:id", (req, res) => {
  const source = sourcesRepo.getSource(req.params.id);
  if (!source) return res.status(404).json({ error: "Source not found." });
  const { starred } = req.body || {};
  if (typeof starred !== "boolean") {
    return res.status(400).json({ error: "Body must be { starred: boolean }." });
  }
  res.json({ source: sourcesRepo.updateSource(req.params.id, { starred: starred ? 1 : 0 }) });
});

// Page outline for the reader UI.
router.get("/pages/:id", (req, res) => {
  const pagesRepo = require("./db/pages");
  const tree = pagesRepo.getPageTree(req.params.id);
  if (!tree) return res.status(404).json({ error: "Page not found." });
  const source = sourcesRepo.getSource(tree.page.sourceId);
  let concepts = [];
  try {
    concepts = require("./db/concepts").listConceptsForPage(tree.page.id);
  } catch {
    // concepts table predates migration on old DBs until restart migrates
    concepts = [];
  }
  res.json({ ...tree, source, concepts });
});

// --- Concepts (P2 Web of notes) ---
router.get("/concepts", (req, res) => {
  try {
    const concepts = require("./db/concepts");
    res.json({ concepts: concepts.listConcepts({ query: req.query.q, limit: req.query.limit }) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

router.get("/concepts/:id", (req, res) => {
  try {
    const concepts = require("./db/concepts");
    const concept = concepts.getConcept(req.params.id);
    if (!concept) return res.status(404).json({ error: "Concept not found." });
    res.json({
      concept,
      linked: concepts.getLinkedBlocks(concept.id, req.query.limit),
      unlinked: concepts.suggestUnlinked(concept.id, 20),
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

router.post("/concepts/:id/accept", (req, res) => {
  try {
    const concepts = require("./db/concepts");
    const concept = concepts.getConcept(req.params.id);
    if (!concept) return res.status(404).json({ error: "Concept not found." });
    const blockId = String((req.body && req.body.blockId) || "");
    if (!blockId) return res.status(400).json({ error: "Body must be { blockId }." });
    const status = concepts.acceptSuggestion({ blockId, conceptId: concept.id });
    // Reindex so the accepted name is searchable on this block immediately.
    try {
      concepts.reindexBlockConcepts(blockId);
    } catch {}
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

router.post("/concepts/:id/reject", (req, res) => {
  try {
    const concepts = require("./db/concepts");
    const concept = concepts.getConcept(req.params.id);
    if (!concept) return res.status(404).json({ error: "Concept not found." });
    const blockId = String((req.body && req.body.blockId) || "");
    if (!blockId) return res.status(400).json({ error: "Body must be { blockId }." });
    concepts.rejectSuggestion({ blockId, conceptId: concept.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Cross-source sweep (E3): promotion + merge suggestions + emerging radar.
router.post("/concepts/sweep", (req, res) => {
  const job = sqliteJobs.enqueueJob({ type: "link_index", sourceId: null, payload: { sweep: true } });
  res.status(202).json({ queued: true, jobId: job.id });
});

router.get("/suggestions", (req, res) => {
  try {
    res.json({ suggestions: require("./db/concepts").listSuggestions({}) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

router.post("/suggestions/:id/accept", (req, res) => {
  try {
    const result = require("./db/concepts").acceptSuggestionById(req.params.id);
    if (!result) return res.status(404).json({ error: "Suggestion not found or already resolved." });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

router.post("/suggestions/:id/reject", (req, res) => {
  try {
    require("./db/concepts").setSuggestionStatus(req.params.id, "rejected");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

router.get("/concepts/emerging/list", (req, res) => {
  try {
    res.json({ emerging: require("./db/concepts").listEmerging(10) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
router.post("/sources/:id/concepts/extract", (req, res) => {
  const source = sourcesRepo.getSource(req.params.id);
  if (!source) return res.status(404).json({ error: "Source not found." });
  // refresh:true forces fresh AI extraction even when the fingerprint is current.
  const job = sqliteJobs.enqueueJob({ type: "link_index", sourceId: source.id, payload: { refresh: true } });
  res.status(202).json({ queued: true, jobId: job.id });
});

router.get("/graph", (req, res) => {
  try {
    res.json(require("./db/concepts").getGraphData({}));
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Zettel drafts (Stage 2): preview is a pure read, commit is additive.
router.get("/sources/:id/zettels/preview", async (req, res) => {
  try {
    const atomize = require("./handlers/atomize");
    const pagesRepo = require("./db/pages");
    const source = sourcesRepo.getSource(req.params.id);
    if (!source) return res.status(404).json({ error: "Source not found." });
    const page = pagesRepo.getPageBySource(source.id);
    if (!page) return res.json({ draft: [], origin: "no-page", existing: 0 });
    const tree = pagesRepo.getPageTree(page.id);
    const existing = atomize.getZettelBlocks(page.id).length;
    if (String(req.query.ai || "") === "1") {
      try {
        const { cards } = await atomize.draftZettelsWithAI({ source, blocks: tree.blocks });
        if (cards.length > 0) return res.json({ draft: cards, origin: "ai", existing });
      } catch (err) {
        // Sidecar down / validation fail → fall through to local with note.
        return res.json({
          draft: atomize.draftZettelsLocal(tree.blocks),
          origin: "local",
          existing,
          aiError: err && err.message ? err.message.slice(0, 200) : String(err),
        });
      }
    }
    res.json({ draft: atomize.draftZettelsLocal(tree.blocks), origin: "local", existing });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

router.post("/sources/:id/zettels/commit", (req, res) => {
  try {
    const atomize = require("./handlers/atomize");
    const pagesRepo = require("./db/pages");
    const mirror = require("./services/mirror");
    const source = sourcesRepo.getSource(req.params.id);
    if (!source) return res.status(404).json({ error: "Source not found." });
    const page = pagesRepo.getPageBySource(source.id);
    if (!page) return res.status(404).json({ error: "No structured page yet." });
    const tree = pagesRepo.getPageTree(page.id);
    const cards = Array.isArray(req.body && req.body.cards) && req.body.cards.length > 0
      ? req.body.cards
      : atomize.draftZettelsLocal(tree.blocks);
    const result = atomize.commitZettels({ pageId: page.id, pageTitle: page.title, cards });
    if (result.written > 0) {
      try {
        mirror.writePageMirror(page.id, {});
      } catch {}
      sqliteJobs.enqueueJob({ type: "backup", sourceId: source.id, payload: {} });
    }
    res.json({ ...result, total: atomize.getZettelBlocks(page.id).length });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Full-text search over blocks, with page + source context per hit.
router.get("/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({ error: "Query must be at least 2 characters." });
  try {
    const pagesRepo = require("./db/pages");
    const results = pagesRepo.searchBlocksWithContext(q, req.query.limit);
    let expanded = [];
    try {
      const concepts = require("./db/concepts");
      expanded = concepts.findConceptsForTokens(pagesRepo.tokenizeQuery(q)).map((c) => c.name);
    } catch {
      expanded = [];
    }
    res.json({ results, expanded });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Anything else under /api: explicit 404 (old Mongo routes are gone).
router.use((req, res) => {
  res.status(404).json({ error: "Unknown API endpoint (revamp P1)." });
});

app.use(API_BASE, router);

function startServer() {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT} (runtime: sqlite)`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, broadcast };
