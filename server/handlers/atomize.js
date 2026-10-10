// Atomize handler (Stage 2 draft): literature blocks → bite-sized Zettel cards.
// Model: attached-first. Zettels are blocks with kind='zettel' + props
// { zettelTitle, sourceBlockId } + a links row (zettel → source block).
// They die with the source (provenance kept); promotion to standalone pages
// is a later migration if cards prove independently valuable.
//
// Two endpoints (wired in server/index.js, manual only for now):
//   POST /api/sources/:id/zettels/preview → { draft: [...] } (no write, AI if
//     sidecar up else deterministic local split)
//   POST /api/sources/:id/zettels/commit  → writes missing zettels + mirror
// Auto-enqueue after structure is intentionally NOT wired yet.
const { z } = require("zod");
const { randomUUID } = require("crypto");
const opencode = require("../services/opencode-client");
const sourcesRepo = require("../db/sources");
const pagesRepo = require("../db/pages");
const { getDb, nowMs } = require("../db/db");

const MAX_BODY = 280;
const MAX_CARDS_PER_BLOCK = 2;
const MAX_CARDS_TOTAL = 24;

const zettelSchema = z.object({
  zettels: z
    .array(
      z.object({
        title: z.string().min(2).max(80),
        body: z.string().min(20).max(600),
        tags: z.array(z.string().min(1).max(40)).default([]),
        sourceBlockId: z.string().min(1),
        aliases: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

function cleanText(s) {
  return String(s || "")
    .replace(/#[\w-]+/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20);
}

// Deterministic fallback: 1 block → 1 card (title = label, body ≤ MAX_BODY).
// Runs offline so the Deck UI is testable without the sidecar.
function draftZettelsLocal(blocks = []) {
  const cards = [];
  for (const b of blocks) {
    const kind = (b.props && b.props.kind) || "note";
    if (kind !== "key-idea" && kind !== "claim" && kind !== "question") continue;
    let title = "";
    let body = cleanText(b.content);
    const m = String(b.content || "").match(/^\*\*(.+?)\*\*:?\s*([\s\S]*)$/);
    if (m) {
      title = cleanText(m[1]).replace(/:$/, "").slice(0, 60);
      body = cleanText(m[2]);
    } else if (kind === "question") {
      title = "Open question";
    } else if (kind === "claim") {
      title = body.slice(0, 48);
      if (body.length > 48) title = `${title.trim()}…`;
    } else {
      title = body.slice(0, 48);
    }
    const sentences = splitSentences(body);
    // Long ideas → max 2 cards on sentence boundaries, each ≤ MAX_BODY.
    let chunks = [body];
    if (body.length > MAX_BODY && sentences.length >= 2) {
      const mid = Math.ceil(sentences.length / 2);
      const a = sentences.slice(0, mid).join(" ");
      const c = sentences.slice(mid).join(" ");
      chunks = [a, c].filter(Boolean).slice(0, MAX_CARDS_PER_BLOCK);
    }
    chunks.forEach((chunk, i) => {
      if (cards.length >= MAX_CARDS_TOTAL) return;
      const clipped = chunk.length > MAX_BODY ? `${chunk.slice(0, MAX_BODY - 1).trim()}…` : chunk;
      cards.push({
        title: chunks.length > 1 ? `${title} (${i + 1}/${chunks.length})` : title || "Note",
        body: clipped,
        tags: [],
        sourceBlockId: b.id,
        timestamp: (b.props && b.props.timestamp) || null,
        aliases: [],
        origin: "local",
      });
    });
  }
  return cards.slice(0, MAX_CARDS_TOTAL);
}

function buildAtomizePrompt({ title, creator, items }) {
  const lines = items
    .slice(0, 20)
    .map((it, i) => `${i + 1}. [${it.kind} id=${it.id}] ${cleanText(it.content).slice(0, 400)}`)
    .join("\n");
  return [
    "You turn structured learning notes into atomic Zettelkasten cards.",
    "Return JSON ONLY with EXACTLY this shape:",
    "{",
    '  "zettels": [{"title": "≤8 words", "body": "1-3 sentences, ≤280 chars, own words", "tags": ["kebab-case"], "sourceBlockId": "<id from input>", "aliases": ["rephrase", "..."]}]',
    "}",
    "Rules:",
    "- ONE idea per card. Split long ideas into 2 cards max (suffix titles (1/2), (2/2)).",
    "- Bodies are self-contained: a stranger must understand without the video.",
    "- Keep the sourceBlockId verbatim so cards link back.",
    "- 1-3 kebab-case tags per card, 1-2 aliases (how a user might rephrase it).",
    "- Max 24 cards total. Skip transcript-like filler.",
    `Source: ${title || "Untitled"}${creator ? ` by ${creator}` : ""}`,
    "",
    "ITEMS:",
    lines,
  ].join("\n");
}

async function draftZettelsWithAI({ source, blocks }) {
  const items = blocks
    .filter((b) => ["key-idea", "claim", "question"].includes((b.props && b.props.kind) || ""))
    .map((b) => ({ id: b.id, kind: (b.props && b.props.kind) || "note", content: b.content }));
  if (items.length === 0) return { cards: [], origin: "ai-empty" };
  const prompt = buildAtomizePrompt({ title: source.title, creator: source.creator, items });
  const raw = await opencode.generateJSON(prompt, "flash");
  if (!raw) throw new Error("AI returned no parseable JSON.");
  const parsed = zettelSchema.parse(raw);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const cards = parsed.zettels.slice(0, MAX_CARDS_TOTAL).map((z) => {
    const src = byId.get(z.sourceBlockId);
    return {
      title: String(z.title).trim().slice(0, 80),
      body: String(z.body).trim().slice(0, 600),
      tags: [...new Set((z.tags || []).map((t) => pagesRepo.normalizeTag(t)).filter(Boolean))].slice(0, 3),
      sourceBlockId: z.sourceBlockId,
      timestamp: src ? src.props && src.props.timestamp : null,
      aliases: [...new Set((z.aliases || []).map((a) => String(a).trim()).filter(Boolean))].slice(0, 3),
      origin: "ai",
    };
  }).filter((c) => byId.has(c.sourceBlockId) && c.body.length >= 10);
  return { cards, origin: "ai" };
}

function getZettelBlocks(pageId) {
  return getDb()
    .prepare("SELECT * FROM blocks WHERE page_id = ? AND json_extract(props_json, '$.kind') = 'zettel' ORDER BY position ASC")
    .all(pageId)
    .map(pagesRepo.mapBlock);
}

// Commit: write missing zettels (skip source blocks that already have one).
// Additive + idempotent — safe to click twice.
function commitZettels({ pageId, pageTitle, cards }) {
  const db = getDb();
  const existing = new Set(getZettelBlocks(pageId).map((b) => b.props && b.props.sourceBlockId).filter(Boolean));
  const fresh = cards.filter((c) => c.sourceBlockId && !existing.has(c.sourceBlockId));
  if (fresh.length === 0) return { written: 0, skipped: cards.length };

  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM blocks WHERE page_id = ?").get(pageId).m;
  let position = maxPos + 1;
  const now = nowMs();
  const insertBlock = db.prepare(
    "INSERT INTO blocks (id, page_id, parent_id, position, content, props_json, created_at, updated_at) VALUES (@id, @page_id, @parent_id, @position, @content, @props_json, @created_at, @updated_at)",
  );
  const insertTag = db.prepare("INSERT OR IGNORE INTO tags (block_id, tag) VALUES (?, ?)");
  const insertFts = db.prepare("INSERT INTO blocks_fts (block_id, title, content, aliases) VALUES (?, ?, ?, ?)");
  const insertLink = db.prepare(
    "INSERT INTO links (id, from_block_id, to_block_id, created_at) VALUES (?, ?, ?, ?)",
  );

  const run = db.transaction(() => {
    for (const c of fresh) {
      const id = randomUUID();
      insertBlock.run({
        id,
        page_id: pageId,
        parent_id: null,
        position: position++,
        content: `**${c.title}:** ${c.body}`,
        props_json: JSON.stringify({ kind: "zettel", zettelTitle: c.title, sourceBlockId: c.sourceBlockId, timestamp: c.timestamp || null, aliases: c.aliases || [], origin: c.origin || "local" }),
        created_at: now,
        updated_at: now,
      });
      for (const t of c.tags || []) insertTag.run(id, t);
      insertFts.run(id, pageTitle || "", `${c.title} ${c.body}`, [...(c.aliases || []), ...(c.tags || [])].join(" "));
      try {
        insertLink.run(randomUUID(), id, c.sourceBlockId, now);
      } catch {
        // source block deleted between preview and commit — keep the card, skip the edge
      }
    }
  });
  run();
  return { written: fresh.length, skipped: cards.length - fresh.length };
}

module.exports = {
  zettelSchema,
  buildAtomizePrompt,
  draftZettelsLocal,
  draftZettelsWithAI,
  getZettelBlocks,
  commitZettels,
  MAX_BODY,
};
