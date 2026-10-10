// Concepts repository (P2 Web of notes).
// Logseq-inspired: concepts are shared pages (one row per entity, UNIQUE
// norm), autocreated on first mention, aliased. Edges (concept_links) attach
// blocks to concepts; blocks cascade with their source, concepts survive.
// Synchronous better-sqlite3 throughout (same discipline as sources/pages).
const { randomUUID } = require("crypto");
const { getDb, nowMs } = require("./db");

function normalizeConceptName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

function parseAliases(row) {
  try {
    const a = JSON.parse(row.aliases_json || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function mapConcept(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    nameNorm: row.name_norm,
    aliases: parseAliases(row),
    status: row.status || "established",
    firstSeen: row.first_seen || row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getConcept(id) {
  return mapConcept(getDb().prepare("SELECT * FROM concepts WHERE id = ?").get(id));
}

function findConceptByNorm(norm) {
  if (!norm) return null;
  return mapConcept(getDb().prepare("SELECT * FROM concepts WHERE name_norm = ?").get(norm));
}

// Autocreate on first mention (Logseq page-name->map pattern). Aliases merge.
function getOrCreateConcept(name, aliases = []) {
  const norm = normalizeConceptName(name);
  if (!norm) return null;
  const db = getDb();
  const existing = findConceptByNorm(norm);
  const cleanAliases = [...new Set((aliases || []).map((a) => String(a).trim()).filter((a) => a && normalizeConceptName(a) !== norm))].slice(0, 8);
  if (existing) {
    if (cleanAliases.length > 0) {
      const merged = [...new Set([...existing.aliases, ...cleanAliases])].slice(0, 8);
      db.prepare("UPDATE concepts SET aliases_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(merged),
        nowMs(),
        existing.id,
      );
      existing.aliases = merged;
    }
    return existing;
  }
  const now = nowMs();
  const row = {
    id: randomUUID(),
    name: String(name).trim().slice(0, 60),
    name_norm: norm,
    aliases_json: JSON.stringify(cleanAliases),
    status: "provisional",
    first_seen: now,
    created_at: now,
    updated_at: now,
  };
  try {
    db.prepare(
      "INSERT INTO concepts (id, name, aliases_json, name_norm, status, first_seen, created_at, updated_at) VALUES (@id, @name, @aliases_json, @name_norm, @status, @first_seen, @created_at, @updated_at)",
    ).run(row);
  } catch (err) {
    // UNIQUE race: two writers autocreate the same concept at once.
    if (String((err && err.message) || "").includes("UNIQUE constraint failed")) {
      return findConceptByNorm(norm);
    }
    throw err;
  }
  return mapConcept(row);
}

function linkBlock({ blockId, conceptId, confidence = 1.0, origin = "ai", evidence = null }) {
  if (!blockId || !conceptId) return false;
  const db = getDb();
  const rejected = db
    .prepare("SELECT 1 FROM concept_rejections WHERE block_id = ? AND concept_id = ?")
    .get(blockId, conceptId);
  if (rejected && origin !== "manual" && origin !== "accepted") return false;
  const cleanEvidence = evidence ? String(evidence).trim().slice(0, 200) : null;
  const info = db
    .prepare(
      "INSERT OR IGNORE INTO concept_links (block_id, concept_id, confidence, origin, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(blockId, conceptId, confidence, origin, cleanEvidence, nowMs());
  if (info.changes === 0 && cleanEvidence) {
    // Edge predates evidence (or a rerun carries a better quote): fill gaps only.
    db.prepare(
      "UPDATE concept_links SET evidence = ? WHERE block_id = ? AND concept_id = ? AND (evidence IS NULL OR evidence = '')",
    ).run(cleanEvidence, blockId, conceptId);
  }
  return info.changes > 0;
}

function promoteIfMultiSource(conceptId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT p.source_id) AS n FROM concept_links cl
       JOIN blocks b ON b.id = cl.block_id JOIN pages p ON p.id = b.page_id
       WHERE cl.concept_id = ?`,
    )
    .get(conceptId);
  if (row && row.n >= 2) {
    db.prepare("UPDATE concepts SET status = 'established', updated_at = ? WHERE id = ?").run(nowMs(), conceptId);
    return true;
  }
  return false;
}

function acceptSuggestion({ blockId, conceptId }) {
  const db = getDb();
  db.prepare("DELETE FROM concept_rejections WHERE block_id = ? AND concept_id = ?").run(blockId, conceptId);
  const existed = db
    .prepare("SELECT 1 FROM concept_links WHERE block_id = ? AND concept_id = ?")
    .get(blockId, conceptId);
  if (existed) {
    db.prepare("UPDATE concept_links SET origin = 'accepted', confidence = 1.0 WHERE block_id = ? AND concept_id = ?").run(blockId, conceptId);
  } else {
    db.prepare(
      "INSERT INTO concept_links (block_id, concept_id, confidence, origin, created_at) VALUES (?, ?, 1.0, 'accepted', ?)",
    ).run(blockId, conceptId, nowMs());
  }
  // A human confirm is the strongest signal: established immediately.
  db.prepare("UPDATE concepts SET status = 'established', updated_at = ? WHERE id = ?").run(nowMs(), conceptId);
  return existed ? "updated" : "linked";
}

function rejectSuggestion({ blockId, conceptId }) {
  const db = getDb();
  db.prepare("DELETE FROM concept_links WHERE block_id = ? AND concept_id = ?").run(blockId, conceptId);
  db.prepare("INSERT OR IGNORE INTO concept_rejections (block_id, concept_id, created_at) VALUES (?, ?, ?)").run(
    blockId,
    conceptId,
    nowMs(),
  );
  return true;
}

function getConceptsForBlock(blockId) {
  return getDb()
    .prepare(
      `SELECT c.* FROM concept_links cl JOIN concepts c ON c.id = cl.concept_id
       WHERE cl.block_id = ? ORDER BY c.name`,
    )
    .all(blockId)
    .map(mapConcept);
}

// One query for a whole page: [{ blockId, conceptId, name, evidence }].
function listConceptsForPage(pageId) {
  return getDb()
    .prepare(
      `SELECT cl.block_id AS block_id, c.id AS concept_id, c.name AS name,
              c.status AS status, cl.evidence AS evidence
       FROM concept_links cl
       JOIN concepts c ON c.id = cl.concept_id
       JOIN blocks b ON b.id = cl.block_id
       WHERE b.page_id = ? ORDER BY c.name`,
    )
    .all(pageId);
}

function listConcepts({ query = "", limit = 50 } = {}) {
  const db = getDb();
  const q = String(query || "").trim().toLowerCase();
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  let rows;
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    rows = db
      .prepare(
        `SELECT c.*, COUNT(DISTINCT cl.block_id) AS block_count,
                COUNT(DISTINCT p.source_id) AS source_count
         FROM concepts c
         LEFT JOIN concept_links cl ON cl.concept_id = c.id
         LEFT JOIN blocks b ON b.id = cl.block_id
         LEFT JOIN pages p ON p.id = b.page_id
         WHERE c.name_norm LIKE ? ESCAPE '\\' OR c.aliases_json LIKE ? ESCAPE '\\'
         GROUP BY c.id ORDER BY block_count DESC, c.name LIMIT ?`,
      )
      .all(like, like, lim);
  } else {
    rows = db
      .prepare(
        `SELECT c.*, COUNT(DISTINCT cl.block_id) AS block_count,
                COUNT(DISTINCT p.source_id) AS source_count
         FROM concepts c
         LEFT JOIN concept_links cl ON cl.concept_id = c.id
         LEFT JOIN blocks b ON b.id = cl.block_id
         LEFT JOIN pages p ON p.id = b.page_id
         GROUP BY c.id ORDER BY block_count DESC, c.name LIMIT ?`,
      )
      .all(lim);
  }
  return rows.map((r) => ({ ...mapConcept(r), blockCount: r.block_count, sourceCount: r.source_count }));
}

// Linked blocks with page/source context (same shape as search hits).
function getLinkedBlocks(conceptId, limit = 50) {
  const pagesRepo = require("./pages");
  return getDb()
    .prepare(
      `SELECT b.*, p.id AS page_id, p.title AS page_title,
              s.id AS source_id, s.title AS source_title,
              s.source_type AS source_type, s.url AS source_url,
              cl.confidence AS confidence, cl.origin AS link_origin,
              cl.evidence AS link_evidence
       FROM concept_links cl
       JOIN blocks b ON b.id = cl.block_id
       JOIN pages p ON p.id = b.page_id
       JOIN sources s ON s.id = p.source_id
       WHERE cl.concept_id = ?
       ORDER BY cl.confidence DESC, b.position ASC LIMIT ?`,
    )
    .all(conceptId, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200))
    .map((r) => ({
      block: pagesRepo.mapBlock(r),
      pageId: r.page_id,
      pageTitle: r.page_title,
      sourceId: r.source_id,
      sourceTitle: r.source_title,
      sourceType: r.source_type,
      sourceUrl: r.source_url,
      confidence: r.confidence,
      linkOrigin: r.link_origin,
      linkEvidence: r.link_evidence || null,
    }));
}

// Unlinked references (Logseq pattern): blocks matching the concept's
// name/alias terms that have no edge and no rejection — the hybrid queue.
function suggestUnlinked(conceptId, limit = 20) {
  const concept = getConcept(conceptId);
  if (!concept) return [];
  const pagesRepo = require("./pages");
  const terms = [concept.name, ...concept.aliases]
    .map((t) => String(t || "").toLowerCase().split(/[^a-z0-9_]+/i).filter((w) => w.length >= 3))
    .filter((ws) => ws.length > 0);
  if (terms.length === 0) return [];
  // AND within each variant (all words of "forward deployed engineer"),
  // OR across name/alias variants.
  const variantQueries = terms
    .map((ws) => `(${ws.slice(0, 6).map((w) => `"${w.replaceAll('"', '""')}"*`).join(" AND ")})`)
    .join(" OR ");
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  return getDb()
    .prepare(
      `SELECT b.*, p.id AS page_id, p.title AS page_title,
              s.id AS source_id, s.title AS source_title,
              s.source_type AS source_type, s.url AS source_url,
              bm25(blocks_fts) AS rank
       FROM blocks_fts
       JOIN blocks b ON b.id = blocks_fts.block_id
       JOIN pages p ON p.id = b.page_id
       JOIN sources s ON s.id = p.source_id
       WHERE blocks_fts MATCH ?
         AND b.id NOT IN (SELECT block_id FROM concept_links WHERE concept_id = ?)
         AND b.id NOT IN (SELECT block_id FROM concept_rejections WHERE concept_id = ?)
       ORDER BY rank LIMIT ?`,
    )
    .all(variantQueries, conceptId, conceptId, lim)
    .map((r) => ({
      block: pagesRepo.mapBlock(r),
      pageId: r.page_id,
      pageTitle: r.page_title,
      sourceId: r.source_id,
      sourceTitle: r.source_title,
      sourceType: r.source_type,
      sourceUrl: r.source_url,
    }));
}

// Graph data: concept nodes + source nodes, edges from concept_links
// (block→concept rolled up to source→concept) plus zettel block→block links.
function getGraphData({ minWeight = 1 } = {}) {
  const db = getDb();
  const conceptRows = db
    .prepare(
      `SELECT c.id, c.name, COUNT(DISTINCT cl.block_id) AS weight,
              COUNT(DISTINCT p.source_id) AS sources
       FROM concepts c
       LEFT JOIN concept_links cl ON cl.concept_id = c.id
       LEFT JOIN blocks b ON b.id = cl.block_id
       LEFT JOIN pages p ON p.id = b.page_id
       GROUP BY c.id HAVING weight >= ? ORDER BY weight DESC LIMIT 200`,
    )
    .all(minWeight);
  const conceptIds = new Set(conceptRows.map((r) => r.id));
  const edgeRows = db
    .prepare(
      `SELECT p.source_id AS source_id, s.title AS source_title, cl.concept_id AS concept_id
       FROM concept_links cl
       JOIN blocks b ON b.id = cl.block_id
       JOIN pages p ON p.id = b.page_id
       JOIN sources s ON s.id = p.source_id
       GROUP BY p.source_id, cl.concept_id`,
    )
    .all()
    .filter((r) => conceptIds.has(r.concept_id));
  const sourceIds = [...new Set(edgeRows.map((r) => r.source_id))];
  return {
    nodes: [
      ...conceptRows.map((r) => ({ id: `c:${r.id}`, type: "concept", label: r.name, weight: r.weight, sources: r.sources, refId: r.id })),
      ...sourceIds.map((id) => {
        const title = (edgeRows.find((r) => r.source_id === id) || {}).source_title || "Source";
        return { id: `s:${id}`, type: "source", label: title, weight: 1, refId: id };
      }),
    ],
    edges: edgeRows.map((r) => ({ from: `s:${r.source_id}`, to: `c:${r.concept_id}`, kind: "mentions" })),
  };
}

// Query-side expansion (generic, no hardcoded terms): if a query token matches
// a concept name/alias, the concept's other names become OR terms. E.g. "FDE"
// retrieves blocks saying "forward deployed engineer" even when neither the
// prose, tags, nor AI aliases contain "fde" — the link runs through the edge.
function findConceptsForTokens(tokens = []) {
  const terms = [...new Set((tokens || []).map((t) => String(t || "").toLowerCase()).filter((t) => t.length >= 2))].slice(0, 8);
  if (terms.length === 0) return [];
  const all = getDb().prepare("SELECT * FROM concepts").all().map(mapConcept);
  return all.filter((c) => {
    const names = [c.nameNorm, ...c.aliases.map((a) => normalizeConceptName(a))].filter(Boolean);
    return terms.some((t) => names.some((n) => n.includes(t) || t.includes(n)));
  }).slice(0, 5);
}

function conceptAliasWords(matched) {
  const words = new Set();
  for (const c of matched || []) {
    for (const text of [c.name, ...c.aliases]) {
      for (const w of String(text || "").toLowerCase().split(/[^a-z0-9_]+/i)) {
        if (w.length >= 3) words.add(w);
      }
    }
  }
  return [...words].slice(0, 12);
}

const WIKILINK_RE = /\[\[([^\[\]]{1,60})\]\]/g;

function extractWikilinks(content) {
  const names = [];
  const re = new RegExp(WIKILINK_RE);
  let m;
  while ((m = re.exec(String(content || ""))) !== null) {
    const name = m[1].trim();
    if (name.length >= 2) names.push(name);
  }
  return [...new Set(names)];
}

function hayFor(block) {
  const aliases = (block.props && block.props.aliases) || [];
  return `${block.content || ""} ${aliases.join(" ")}`.toLowerCase();
}

function flatForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[*_`#[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Core sync linker (runs inside structure; no AI call here — entities arrive
// in the pro response). Assignment prefers evidence quotes (E1): a block
// containing the entity's verbatim evidence sentence links at 1.0 with the
// quote stored on the edge. Fallbacks: name mention → 1.0, alias → 0.8,
// shared tag → 0.6, [[wikilink]] → 1.0.
// Linked blocks get concept names merged into FTS so "palantir" finds a card
// whose concept is Palantir even when prose never says it.
function linkEntitiesForPage({ pageId, entities = [], tags = [] }) {
  const pagesRepo = require("./pages");
  const db = getDb();
  const tree = pagesRepo.getPageTree(pageId);
  if (!tree) return 0;
  const NOTE_KINDS = new Set(["tldr", "key-idea", "claim", "question", "zettel"]);
  const notes = tree.blocks.filter((b) => NOTE_KINDS.has((b.props && b.props.kind) || ""));
  const flatBlocks = notes.map((b) => ({ block: b, flat: flatForMatch(`${b.content} ${(b.props.aliases || []).join(" ")}`) }));

  const wanted = [];
  for (const e of entities || []) {
    const concept = getOrCreateConcept(e.name, e.aliases);
    if (concept) wanted.push({ concept, aliases: e.aliases || [], evidence: e.evidence || "", fromTag: false });
  }
  for (const t of tags || []) {
    // Tags become concepts too (Logseq tag-as-page): exact per-block links
    // via the tags table, so no content guessing involved.
    const concept = getOrCreateConcept(t, [String(t).replace(/-/g, " ")]);
    if (concept) wanted.push({ concept, aliases: [], evidence: "", fromTag: true, tag: pagesRepo.normalizeTag(t) });
  }

  let written = 0;
  const touched = new Set();
  const touchedConcepts = new Set();
  const run = db.transaction(() => {
    for (const { concept, aliases, evidence, fromTag, tag } of wanted) {
      const norms = [concept.nameNorm, ...aliases.map((a) => normalizeConceptName(a))].filter(Boolean);
      const flatEvidence = evidence ? flatForMatch(evidence) : "";
      for (const { block: b, flat: hay } of flatBlocks) {
        const bId = b.id;
        let conf = 0;
        let origin = "ai";
        let edgeEvidence = null;
        if (flatEvidence.length >= 20 && hay.includes(flatEvidence.slice(0, 120))) {
          // Evidence-anchored: the block holds the sentence the entity came from.
          conf = 1.0;
          edgeEvidence = evidence.trim().slice(0, 200);
        } else if (hay.includes(concept.nameNorm) && concept.nameNorm.length >= 3) {
          conf = 1.0;
        } else {
          const aliasHit = norms.slice(1).find((n) => n.length >= 3 && hay.includes(n));
          if (aliasHit) {
            conf = 0.8;
          }
        }
        if (fromTag) {
          const blockTags = db.prepare("SELECT 1 FROM tags WHERE block_id = ? AND tag = ?").get(bId, tag);
          if (blockTags) {
            if (conf < 0.6) {
              conf = 0.6;
              origin = "tag";
            } else origin = "ai";
          } else if (conf === 0) continue;
          else origin = "ai";
        } else if (conf === 0) {
          continue;
        }
        if (linkBlock({ blockId: bId, conceptId: concept.id, confidence: conf, origin, evidence: edgeEvidence })) {
          written += 1;
          touched.add(bId);
          touchedConcepts.add(concept.id);
        } else if (edgeEvidence) {
          // Edge predated evidence: backfill the quote + mark touched for UI.
          db.prepare(
            "UPDATE concept_links SET evidence = ? WHERE block_id = ? AND concept_id = ? AND (evidence IS NULL OR evidence = '')",
          ).run(edgeEvidence.trim().slice(0, 200), bId, concept.id);
          touchedConcepts.add(concept.id);
        }
      }
    }
    // [[Wikilinks]] in any notes block resolve to concepts.
    for (const b of notes) {
      for (const name of extractWikilinks(b.content)) {
        const concept = getOrCreateConcept(name, []);
        if (concept && linkBlock({ blockId: b.id, conceptId: concept.id, confidence: 1.0, origin: "wikilink" })) {
          written += 1;
          touched.add(b.id);
          touchedConcepts.add(concept.id);
        }
      }
    }
    // Multi-source concepts graduate: seen in 2+ sources → established.
    for (const conceptId of touchedConcepts) promoteIfMultiSource(conceptId);
    // Reindex touched blocks so concept names are searchable immediately.
    for (const blockId of touched) {
      const b = db.prepare("SELECT * FROM blocks WHERE id = ?").get(blockId);
      if (!b) continue;
      const block = pagesRepo.mapBlock(b);
      const blockTags = db.prepare("SELECT tag FROM tags WHERE block_id = ?").all(blockId).map((r) => r.tag);
      const blockConcepts = db
        .prepare("SELECT c.name FROM concept_links cl JOIN concepts c ON c.id = cl.concept_id WHERE cl.block_id = ?")
        .all(blockId)
        .map((r) => r.name);
      pagesRepo.indexBlock({
        blockId,
        title: tree.page.title,
        content: block.content,
        aliases: [...(block.props.aliases || []), ...blockConcepts],
        tags: blockTags,
      });
    }
  });
  run();
  try {
    setLinkState(pageId, computePageFingerprint(tree, entities, tags), written);
  } catch {
    // link_state missing pre-004 on a stale handle — linking already succeeded
  }
  return written;
}

// Fingerprint gate: reruns with an unchanged page short-circuit. Hash covers
// block identity + content (catches restructures) and tags — deliberately NOT
// the volatile AI entities (model rewording must not defeat the cache; links
// are idempotent anyway). Pass {refresh:true} to force fresh extraction.
function computePageFingerprint(tree, entities = [], tags = []) {
  const { createHash } = require("crypto");
  const h = createHash("sha1");
  for (const b of tree.blocks || []) h.update(`${b.id}|${b.content}|${JSON.stringify(b.props)};`);
  h.update(`tags:${[...(tags || [])].sort().join(",")};`);
  return h.digest("hex");
}

function getLinkState(pageId) {
  try {
    return getDb().prepare("SELECT * FROM link_state WHERE page_id = ?").get(pageId) || null;
  } catch {
    return null;
  }
}

function setLinkState(pageId, fingerprint, linksWritten) {
  getDb()
    .prepare(
      "INSERT INTO link_state (page_id, fingerprint, links_written, ran_at) VALUES (?, ?, ?, ?) ON CONFLICT(page_id) DO UPDATE SET fingerprint = excluded.fingerprint, links_written = excluded.links_written, ran_at = excluded.ran_at",
    )
    .run(pageId, fingerprint, linksWritten, nowMs());
}

// Reindex one block's FTS from current tags + concept names (follows merges,
// accepts, alias changes). Shared by routes and sweep.
function reindexBlockConcepts(blockId) {
  const pagesRepo = require("./pages");
  const db = getDb();
  const b = db.prepare("SELECT * FROM blocks WHERE id = ?").get(blockId);
  if (!b) return false;
  const block = pagesRepo.mapBlock(b);
  const page = db.prepare("SELECT * FROM pages WHERE id = ?").get(block.pageId);
  const blockTags = db.prepare("SELECT tag FROM tags WHERE block_id = ?").all(blockId).map((r) => r.tag);
  const names = db
    .prepare("SELECT c.name FROM concept_links cl JOIN concepts c ON c.id = cl.concept_id WHERE cl.block_id = ?")
    .all(blockId)
    .map((r) => r.name);
  pagesRepo.indexBlock({
    blockId,
    title: page ? page.title : "",
    content: block.content,
    aliases: [...(block.props.aliases || []), ...names],
    tags: blockTags,
  });
  return true;
}

// --- E3 sweep support: suggestions queue, promotion, emerging ---

function listSuggestions({ status = "pending", limit = 50 } = {}) {
  return getDb()
    .prepare(
      `SELECT s.*, c.name AS concept_name FROM concept_suggestions s
       JOIN concepts c ON c.id = s.concept_id
       WHERE s.status = ? ORDER BY s.created_at DESC LIMIT ?`,
    )
    .all(status, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      conceptId: r.concept_id,
      conceptName: r.concept_name,
      payload: JSON.parse(r.payload_json || "{}"),
      reason: r.reason || "",
      status: r.status,
      createdAt: r.created_at,
    }));
}

function addSuggestion({ kind, conceptId, payload = {}, reason = "" }) {
  const db = getDb();
  const key = JSON.stringify(payload);
  const dupe = db
    .prepare("SELECT id FROM concept_suggestions WHERE kind = ? AND concept_id = ? AND payload_json = ? AND status = 'pending'")
    .get(kind, conceptId, key);
  if (dupe) return dupe.id;
  const id = randomUUID();
  db.prepare(
    "INSERT INTO concept_suggestions (id, kind, concept_id, payload_json, reason, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
  ).run(id, kind, conceptId, key, String(reason || "").slice(0, 300), nowMs());
  return id;
}

function setSuggestionStatus(id, status) {
  getDb().prepare("UPDATE concept_suggestions SET status = ? WHERE id = ?").run(status, id);
}

// Accept: alias → merge into concept.aliases + reindex its blocks;
// merge → move loser's edges/rejections/aliases to winner, delete loser.
function acceptSuggestionById(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM concept_suggestions WHERE id = ?").get(id);
  if (!row || row.status !== "pending") return null;
  const payload = JSON.parse(row.payload_json || "{}");
  if (row.kind === "alias" && payload.alias) {
    const concept = getOrCreateConcept(getConcept(row.concept_id).name, [payload.alias]);
    const blockIds = db.prepare("SELECT block_id FROM concept_links WHERE concept_id = ?").all(row.concept_id).map((r) => r.block_id);
    const run = db.transaction(() => {
      setSuggestionStatus(id, "accepted");
      db.prepare("UPDATE concepts SET status = 'established', updated_at = ? WHERE id = ?").run(nowMs(), row.concept_id);
    });
    run();
    for (const bid of blockIds) reindexBlockConcepts(bid);
    return { kind: "alias", concept: concept.name };
  }
  if (row.kind === "merge" && payload.from_concept_id) {
    const winner = getConcept(row.concept_id);
    const loser = getConcept(payload.from_concept_id);
    if (!winner || !loser) {
      setSuggestionStatus(id, "rejected");
      return null;
    }
    const run = db.transaction(() => {
      // Winner absorbs loser's aliases + edges + rejections; loser row goes.
      const merged = [...new Set([...winner.aliases, loser.name, ...loser.aliases])].slice(0, 8);
      db.prepare("UPDATE concepts SET aliases_json = ?, status = 'established', updated_at = ? WHERE id = ?").run(
        JSON.stringify(merged),
        nowMs(),
        winner.id,
      );
      db.prepare(
        "INSERT OR IGNORE INTO concept_links (block_id, concept_id, confidence, origin, evidence, created_at) SELECT block_id, ?, confidence, origin, evidence, created_at FROM concept_links WHERE concept_id = ?",
      ).run(winner.id, loser.id);
      db.prepare(
        "INSERT OR IGNORE INTO concept_rejections (block_id, concept_id, created_at) SELECT block_id, ?, created_at FROM concept_rejections WHERE concept_id = ?",
      ).run(winner.id, loser.id);
      db.prepare("DELETE FROM concept_links WHERE concept_id = ?").run(loser.id);
      db.prepare("DELETE FROM concept_rejections WHERE concept_id = ?").run(loser.id);
      db.prepare("DELETE FROM concept_suggestions WHERE concept_id = ? AND status = 'pending'").run(loser.id);
      db.prepare("DELETE FROM concepts WHERE id = ?").run(loser.id);
      setSuggestionStatus(id, "accepted");
    });
    run();
    for (const r of db.prepare("SELECT block_id FROM concept_links WHERE concept_id = ?").all(winner.id)) {
      reindexBlockConcepts(r.block_id);
    }
    return { kind: "merge", winner: winner.name, loser: loser.name };
  }
  return null;
}

// Provisionals ranked by cross-source spread — the Emerging radar.
function listEmerging(limit = 10) {
  const db = getDb();
  return db
    .prepare(
      `SELECT c.*, COUNT(DISTINCT cl.block_id) AS block_count,
              COUNT(DISTINCT p.source_id) AS source_count
       FROM concepts c
       LEFT JOIN concept_links cl ON cl.concept_id = c.id
       LEFT JOIN blocks b ON b.id = cl.block_id
       LEFT JOIN pages p ON p.id = b.page_id
       WHERE c.status = 'provisional'
       GROUP BY c.id ORDER BY source_count DESC, block_count DESC, c.first_seen DESC LIMIT ?`,
    )
    .all(Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50))
    .map((r) => ({ ...mapConcept(r), blockCount: r.block_count, sourceCount: r.source_count }));
}

function tokenSet(s) {
  return new Set(String(s || "").toLowerCase().split(/[^a-z0-9_]+/i).filter((w) => w.length >= 3));
}

// Candidate alias/merge pairs: token overlap + shared source context.
// Local + deterministic; flash judges same/distinct in the sweep job.
// Note: alias overlap across two rows is a merge CANDIDATE, not a skip —
// the rows are still split. Only pairs with a pending suggestion are skipped.
function candidatePairs(limit = 15) {
  const db = getDb();
  const all = db.prepare("SELECT * FROM concepts").all().map(mapConcept);
  const pending = new Set(
    db.prepare("SELECT concept_id, payload_json FROM concept_suggestions WHERE kind = 'merge' AND status = 'pending'")
      .all()
      .map((r) => {
        try {
          const other = JSON.parse(r.payload_json || "{}").from_concept_id;
          return [r.concept_id, other].sort().join("~");
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  );
  const pairs = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (pending.has([a.id, b.id].sort().join("~"))) continue;
      const wa = tokenSet(a.name);
      const wb = tokenSet(b.name);
      const inter = [...wa].filter((w) => wb.has(w)).length;
      const union = new Set([...wa, ...wb]).size;
      const jaccard = union === 0 ? 0 : inter / union;
      const eitherContains =
        a.nameNorm.includes(b.nameNorm) || b.nameNorm.includes(a.nameNorm);
      if (jaccard >= 0.4 || eitherContains) {
        pairs.push({ a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, jaccard: Math.round(jaccard * 100) / 100 });
      }
      if (pairs.length >= limit) break;
    }
    if (pairs.length >= limit) break;
  }
  return pairs;
}

module.exports = {
  normalizeConceptName,
  getConcept,
  findConceptByNorm,
  getOrCreateConcept,
  linkBlock,
  acceptSuggestion,
  rejectSuggestion,
  getConceptsForBlock,
  listConceptsForPage,
  listConcepts,
  getLinkedBlocks,
  suggestUnlinked,
  findConceptsForTokens,
  conceptAliasWords,
  getGraphData,
  extractWikilinks,
  linkEntitiesForPage,
  computePageFingerprint,
  getLinkState,
  setLinkState,
  promoteIfMultiSource,
  reindexBlockConcepts,
  listSuggestions,
  addSuggestion,
  setSuggestionStatus,
  acceptSuggestionById,
  listEmerging,
  candidatePairs,
};
