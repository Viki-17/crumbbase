// Summary backfill: one-shot dense "Detailed summary" for pages structured
// before the field existed. Additive only — never replaces the page, so
// zettels and concept edges survive. New captures get the summary inline in
// the structure handler; this path is for old pages via
// POST /api/sources/:id/summary/backfill.
const { z } = require("zod");
const { randomUUID } = require("crypto");
const opencode = require("../services/opencode-client");
const sourcesRepo = require("../db/sources");
const pagesRepo = require("../db/pages");
const jobs = require("../db/jobs");
const mirror = require("../services/mirror");
const { getDb, nowMs } = require("../db/db");
const { truncateTranscript } = require("./structure");

const SUMMARY_MAX_CHARS = 6000;

const summarySchema = z.object({
  detailedSummary: z.string().min(1),
});

function buildSummaryPrompt({ title, creator, url, transcript }) {
  return [
    "You turn a video/podcast transcript into a dense study summary.",
    "Return JSON ONLY (no markdown fences, no commentary) with EXACTLY this shape:",
    '{"detailedSummary": "dense 300-600 word markdown summary"}',
    "Rules:",
    "- 300-600 words of dense markdown prose: the central thesis, how the sections build the argument, key reasoning and evidence, connections between concepts, nuances/counterpoints/caveats, and essential terms.",
    "- Maximize information per word, no filler, never invent facts; preserve attribution and uncertainty.",
    "- Paragraph breaks as blank lines; bullets only where a list carries real density.",
    `Title: ${title || "Untitled"}`,
    creator ? `Creator: ${creator}` : null,
    `URL: ${url}`,
    "",
    "TRANSCRIPT:",
    truncateTranscript(transcript),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

async function backfillSummaryForSource(sourceId) {
  const source = sourcesRepo.getSource(sourceId);
  if (!source) {
    const err = new Error("Source not found.");
    err.status = 404;
    throw err;
  }
  const page = pagesRepo.getPageBySource(source.id);
  if (!page) {
    const err = new Error("No structured page yet.");
    err.status = 404;
    throw err;
  }
  const tree = pagesRepo.getPageTree(page.id);
  const existing = (tree.blocks || []).find(
    (b) => b.props && b.props.kind === "detailed-summary" && String(b.content || "").trim(),
  );
  if (existing) return { skipped: true, blockId: existing.id };

  const transcript = sourcesRepo.getTranscript(source.id);
  if (!transcript || !String(transcript.text || "").trim()) {
    const err = new Error("No transcript saved for this source yet.");
    err.status = 400;
    throw err;
  }

  const log = (level, message) => jobs.addLog({ sourceId: source.id, level, message });
  await log("info", "Backfilling detailed summary.");

  let parsed;
  try {
    const raw = await opencode.generateJSON(
      buildSummaryPrompt({
        title: source.title,
        creator: source.creator,
        url: source.canonicalUrl,
        transcript: transcript.text,
      }),
      "pro",
    );
    if (!raw) throw new Error("AI returned no parseable JSON.");
    parsed = summarySchema.parse(raw);
  } catch (err) {
    if (err && err.name === "ZodError") {
      const first = err.issues && err.issues[0];
      const wrapped = new Error(
        `AI summary failed validation: ${first ? `${first.path.join(".")}: ${first.message}` : "unknown"}`,
      );
      wrapped.status = 502;
      throw wrapped;
    }
    if (err && err.status) throw err;
    const wrapped = new Error(err && err.message ? err.message : String(err));
    wrapped.status = 502;
    throw wrapped;
  }

  const summaryText = String(parsed.detailedSummary || "").trim().slice(0, SUMMARY_MAX_CHARS).trim();
  if (!summaryText) {
    const err = new Error("AI returned an empty summary.");
    err.status = 502;
    throw err;
  }

  const db = getDb();
  const now = nowMs();
  const id = randomUUID();
  const tags = tree.tags || [];
  db.transaction(() => {
    db.prepare("UPDATE blocks SET position = position + 1, updated_at = @now WHERE page_id = @pageId AND position >= 1").run({
      now,
      pageId: page.id,
    });
    db.prepare(
      "INSERT INTO blocks (id, page_id, parent_id, position, content, props_json, created_at, updated_at) VALUES (@id, @page_id, @parent_id, @position, @content, @props_json, @created_at, @updated_at)",
    ).run({
      id,
      page_id: page.id,
      parent_id: null,
      position: 1,
      content: summaryText,
      props_json: JSON.stringify({ kind: "detailed-summary" }),
      created_at: now,
      updated_at: now,
    });
    const insertTag = db.prepare("INSERT OR IGNORE INTO tags (block_id, tag) VALUES (?, ?)");
    for (const t of tags) insertTag.run(id, t);
  })();
  pagesRepo.indexBlock({ blockId: id, title: page.title, content: summaryText, aliases: [], tags });
  db.prepare("UPDATE pages SET updated_at = ? WHERE id = ?").run(now, page.id);

  try {
    mirror.writePageMirror(page.id, {});
  } catch {
    // mirror failure must not fail the backfill
  }
  jobs.enqueueJob({ type: "backup", sourceId: source.id, payload: {} });
  // New prose shifts the page fingerprint, so the gate lets this through and
  // the summary's entities get linked without a forced refresh.
  jobs.enqueueJob({ type: "link_index", sourceId: source.id, payload: {} });

  await log("info", `Detailed summary backfilled (${summaryText.length} chars).`);
  return { skipped: false, blockId: id };
}

module.exports = { backfillSummaryForSource, buildSummaryPrompt, summarySchema };
