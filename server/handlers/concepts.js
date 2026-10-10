// link_index handler: concept extraction for pages that predate entities
// (or a manual re-run). Flash-tier AI draft with the live concept catalog for
// cross-source name consistency, local fallback from page tags + [[wikilinks]]
// so it works with the sidecar down. Fingerprint-gated: identical inputs
// short-circuit, so reruns/retries are free. Links are INSERT OR IGNORE +
// rejection-aware.
const { z } = require("zod");
const opencode = require("../services/opencode-client");
const sourcesRepo = require("../db/sources");
const pagesRepo = require("../db/pages");
const concepts = require("../db/concepts");
const jobs = require("../db/jobs");
const events = require("../services/events");
const mirror = require("../services/mirror");

const entitySchema = z.object({
  entities: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        aliases: z.array(z.string()).default([]),
        evidence: z.string().default(""),
      }),
    )
    .default([]),
});

const MAX_CATALOG = 40;

function catalogLine() {
  try {
    const all = concepts.listConcepts({ limit: MAX_CATALOG });
    if (all.length === 0) return null;
    return all
      .map((c) => `- ${c.name}${c.aliases.length > 0 ? ` (aka ${c.aliases.slice(0, 3).join(", ")})` : ""}`)
      .join("\n");
  } catch {
    return null;
  }
}

function buildEntityPrompt({ title, creator, items }) {
  const lines = items
    .slice(0, 20)
    .map((it, i) => `${i + 1}. [${it.kind}] ${String(it.content || "").replace(/#[\w-]+/g, "").trim().slice(0, 350)}`)
    .join("\n");
  const catalog = catalogLine();
  return [
    "Extract the named entities central to these learning notes.",
    "Return JSON ONLY with EXACTLY this shape:",
    '{"entities": [{"name": "Palantir", "aliases": ["palantir technologies"], "evidence": "verbatim sentence from the items where it appears"}]}',
    "Rules:",
    "- 5-12 entities: companies, people, frameworks, named roles/practices (e.g. 'forward deployed engineer'), movements.",
    "- Each with 1-3 aliases (acronyms, alternate casings/phrasings) and the verbatim evidence sentence.",
    "- Skip generic words (company, team, engineer alone).",
    catalog
      ? "- EXISTING CONCEPTS below: reuse an existing name VERBATIM when it's the same thing (prevents duplicates). Only coin a new name for something genuinely absent."
      : "- No existing concepts yet: name things in their most standard form.",
    `Source: ${title || "Untitled"}${creator ? ` by ${creator}` : ""}`,
    catalog ? "" : null,
    catalog ? "EXISTING CONCEPTS:" : null,
    catalog,
    "",
    "ITEMS:",
    lines,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function cleanText(s) {
  return String(s || "").replace(/#[\w-]+/g, "").replace(/\*\*/g, "").trim();
}

async function extractEntities({ source, blocks }) {
  const items = blocks
    .filter((b) => ["tldr", "key-idea", "claim", "question", "zettel"].includes((b.props && b.props.kind) || ""))
    .map((b) => ({ kind: (b.props && b.props.kind) || "note", content: cleanText(b.content) }));
  if (items.length === 0) return { entities: [], origin: "empty" };
  try {
    const raw = await opencode.generateJSON(
      buildEntityPrompt({ title: source.title, creator: source.creator, items }),
      "flash",
    );
    if (!raw) throw new Error("AI returned no parseable JSON.");
    const parsed = entitySchema.parse(raw);
    const entities = parsed.entities
      .map((e) => ({
        name: String(e.name).trim().slice(0, 60),
        aliases: [...new Set((e.aliases || []).map((a) => String(a).trim()).filter(Boolean))].slice(0, 3),
        evidence: String(e.evidence || "").trim().slice(0, 200),
      }))
      .filter((e) => e.name.length >= 2)
      .slice(0, 12);
    if (entities.length > 0) return { entities, origin: "ai" };
  } catch (err) {
    if (err && err.name === "ZodError") throw err;
    // Sidecar down etc. → local fallback below.
  }
  // Local fallback: page tags become entities (exact per-block links via tags
  // table) + [[wikilinks]] resolve directly. No AI needed — linkEntitiesForPage
  // handles both from { entities: [], tags }.
  return { entities: [], origin: "local" };
}

async function handleLinkIndex(job) {
  if (job.payload && job.payload.sweep) return handleSweep(job);
  const source = sourcesRepo.getSource(job.sourceId);
  if (!source) {
    await jobs.addLog({ sourceId: job.sourceId, level: "warn", message: "link_index: source deleted, skipping." });
    return;
  }
  const page = pagesRepo.getPageBySource(source.id);
  if (!page) {
    await jobs.addLog({ sourceId: job.sourceId, level: "warn", message: "link_index: no structured page yet." });
    return;
  }
  const log = (level, message) => jobs.addLog({ sourceId: source.id, level, message });
  const tree = pagesRepo.getPageTree(page.id);

  // Fingerprint gate BEFORE any AI call: unchanged pages skip unless forced.
  // (Manual "Link concepts" sends {refresh:true}; retries reuse {}.)
  const force = !!(job.payload && job.payload.refresh);
  if (!force) {
    try {
      const fp = concepts.computePageFingerprint(tree, [], tree.tags);
      const prior = concepts.getLinkState(page.id);
      if (prior && prior.fingerprint === fp) {
        await log("info", "Concept linking already current — skipped (fingerprint match).");
        events.publishEvent({ type: "conceptsLinked", sourceId: source.id, written: 0 });
        return { written: 0, origin: "cached" };
      }
    } catch {
      // link_state missing pre-004 — proceed, linker records it after
    }
  }

  let entities = [];
  let origin = "local";
  const payloadEntities =
    job.payload && Array.isArray(job.payload.entities) && job.payload.entities.length > 0
      ? job.payload.entities
      : null;
  if (payloadEntities) {
    entities = payloadEntities;
    origin = "payload";
  } else {
    const extracted = await extractEntities({ source, blocks: tree.blocks });
    entities = extracted.entities;
    origin = extracted.origin;
  }

  const written = concepts.linkEntitiesForPage({ pageId: page.id, entities, tags: tree.tags });
  try {
    mirror.writePageMirror(page.id, {});
  } catch {
    // mirror failure must not fail linking
  }
  await log("info", `Concept linking complete (${written} edges, ${entities.length} entities via ${origin}).`);
  events.publishEvent({ type: "conceptsLinked", sourceId: source.id, written });
  return { written, origin };
}

module.exports = { handleLinkIndex, handleSweep, extractEntities, buildEntityPrompt, entitySchema };

// E3 cross-source sweep (flash, candidates-only — never full transcripts):
// 1. deterministic promotion (provisional seen in 2+ sources → established),
// 2. flash judges candidate duplicate pairs → merge suggestions (never silent),
// 3. emerging radar returned for the UI.
const sweepSchema = z.object({
  judgments: z
    .array(
      z.object({
        pair: z.number().int().min(1),
        verdict: z.enum(["same", "distinct"]),
        winner: z.enum(["a", "b"]).nullable().default(null),
        reason: z.string().default(""),
      }),
    )
    .default([]),
});

function buildSweepPrompt(pairs) {
  const lines = pairs.map((p, i) => `${i + 1}. "${p.a.name}" vs "${p.b.name}" (word overlap ${p.jaccard})`).join("\n");
  return [
    "Decide whether these pairs of knowledge-base concept names refer to the SAME thing.",
    "Return JSON ONLY with EXACTLY this shape:",
    '{"judgments": [{"pair": 1, "verdict": "same"|"distinct", "winner": "a"|"b"|null, "reason": "short"}]}',
    "Rules:",
    "- 'same' only when they unambiguously denote one entity (acronyms, casing/plural variants, tag-vs-proper forms like 'ai-displacement' vs 'AI displacement').",
    "- 'winner' is the canonical display name (prefer the fuller, properly-cased form).",
    "- When in doubt, 'distinct' — a missed merge can be suggested later, a wrong merge corrupts links.",
    "- Reference pairs by their NUMBER, copying no names.",
    "",
    "PAIRS:",
    lines,
  ].join("\n");
}

async function handleSweep(job) {
  const log = (level, message) => jobs.addLog({ sourceId: job.sourceId || null, level, message });
  const db = require("../db/db").getDb();

  const scanned = {
    concepts: db.prepare("SELECT COUNT(*) AS c FROM concepts").get().c,
    links: db.prepare("SELECT COUNT(*) AS c FROM concept_links").get().c,
  };
  if (scanned.concepts === 0) {
    await log("info", "Concept sweep: nothing to do — no concepts exist yet. Run per-page extraction first (Link concepts button or a new capture).");
    events.publishEvent({ type: "conceptsSwept", promoted: 0, suggestions: 0, scanned });
    return { promoted: 0, suggestions: 0, emerging: [], scanned };
  }

  // 1. Deterministic promotion — no AI needed.
  const promoted = db
    .prepare(
      `UPDATE concepts SET status = 'established', updated_at = ?
       WHERE status = 'provisional' AND id IN (
         SELECT cl.concept_id FROM concept_links cl
         JOIN blocks b ON b.id = cl.block_id JOIN pages p ON p.id = b.page_id
         GROUP BY cl.concept_id HAVING COUNT(DISTINCT p.source_id) >= 2
       )`,
    )
    .run(Date.now()).changes;

  // 2. Flash judges candidate duplicate pairs → pending merge suggestions.
  const pairs = concepts.candidatePairs(12);
  let suggestions = 0;
  if (pairs.length > 0) {
    try {
      const raw = await opencode.generateJSON(buildSweepPrompt(pairs), "flash");
      const parsed = sweepSchema.parse(raw || { judgments: [] });
      for (const j of parsed.judgments) {
        if (j.verdict !== "same") continue;
        const pair = pairs[j.pair - 1];
        if (!pair) continue; // model referenced a nonexistent pair — ignore
        const winner = j.winner === "b" ? pair.b : pair.a;
        const loser = j.winner === "b" ? pair.a : pair.b;
        concepts.addSuggestion({
          kind: "merge",
          conceptId: winner.id,
          payload: { from_concept_id: loser.id },
          reason: j.reason || `Sweep judged "${loser.name}" the same as "${winner.name}"`,
        });
        suggestions += 1;
      }
    } catch (err) {
      await log("warn", `Sweep pair-judging skipped: ${err && err.message ? err.message : err}`);
    }
  }

  const emerging = concepts.listEmerging(10);
  await log("info", `Concept sweep complete (scanned ${scanned.concepts} concepts / ${scanned.links} links; promoted ${promoted}, ${suggestions} merge suggestions, ${emerging.length} emerging).`);
  events.publishEvent({ type: "conceptsSwept", promoted, suggestions, scanned });
  return { promoted, suggestions, emerging: emerging.map((c) => c.name), scanned };
}
