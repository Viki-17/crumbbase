// Pages + blocks + tags repository (revamp P1).
// Blocks form the outline tree (parent_id/position); FTS rows are maintained
// explicitly alongside writes (learncache refreshSearchIndex pattern).
const { randomUUID } = require("crypto");
const { getDb, nowMs } = require("./db");

function mapBlock(row) {
  if (!row) return null;
  let props = {};
  try {
    props = JSON.parse(row.props_json || "{}");
  } catch {
    props = {};
  }
  return {
    id: row.id,
    pageId: row.page_id,
    parentId: row.parent_id,
    position: row.position,
    content: row.content,
    props,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createPage({ sourceId, title }) {
  const now = nowMs();
  const page = { id: randomUUID(), source_id: sourceId, title: title || "Untitled", created_at: now, updated_at: now };
  getDb()
    .prepare("INSERT INTO pages (id, source_id, title, created_at, updated_at) VALUES (@id, @source_id, @title, @created_at, @updated_at)")
    .run(page);
  return { id: page.id, sourceId, title: page.title, createdAt: now, updatedAt: now };
}

function getPageBySource(sourceId) {
  const row = getDb().prepare("SELECT * FROM pages WHERE source_id = ?").get(sourceId);
  return row ? { id: row.id, sourceId: row.source_id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

// Full replace: wipes blocks (+ their FTS rows, links, tags via cascades)
// so a retried structure job never duplicates. FTS is NOT FK-managed, so it
// is deleted explicitly first.
const replacePageForSource = (function () {
  let stmts = null;
  function prepare(db) {
    if (!stmts) {
      stmts = {
        blockIds: db.prepare("SELECT id FROM blocks WHERE page_id = ?"),
        deleteFts: db.prepare("DELETE FROM blocks_fts WHERE block_id = ?"),
        deletePage: db.prepare("DELETE FROM pages WHERE id = ?"),
      };
    }
    return stmts;
  }
  return (sourceId, title) => {
    const db = getDb();
    const existing = getPageBySource(sourceId);
    const run = db.transaction(() => {
      if (existing) {
        const s = prepare(db);
        for (const b of s.blockIds.all(existing.id)) s.deleteFts.run(b.id);
        s.deletePage.run(existing.id);
      }
    });
    run();
    return createPage({ sourceId, title });
  };
})();

function addBlock({ pageId, parentId = null, position = 0, content = "", props = {} }) {
  const now = nowMs();
  const row = {
    id: randomUUID(),
    page_id: pageId,
    parent_id: parentId,
    position,
    content,
    props_json: JSON.stringify(props || {}),
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      "INSERT INTO blocks (id, page_id, parent_id, position, content, props_json, created_at, updated_at) VALUES (@id, @page_id, @parent_id, @position, @content, @props_json, @created_at, @updated_at)",
    )
    .run(row);
  return mapBlock(row);
}

function addTag(blockId, tag) {
  const clean = normalizeTag(tag);
  if (!clean) return null;
  getDb().prepare("INSERT OR IGNORE INTO tags (block_id, tag) VALUES (?, ?)").run(blockId, clean);
  return clean;
}

function normalizeTag(tag) {
  return String(tag || "")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function indexBlock({ blockId, title, content, aliases = [], tags = [] }) {
  const db = getDb();
  // Tags ride in the aliases column (no schema change): a block tagged
  // #palantir matches "palantir" even when the word never appears in prose.
  // FTS tokenizes hyphens, so "forward-deployed-engineer" also matches
  // "forward deployed".
  const aliasText = [...(aliases || []), ...(tags || [])].join(" ");
  db.prepare("DELETE FROM blocks_fts WHERE block_id = ?").run(blockId);
  db.prepare("INSERT INTO blocks_fts (block_id, title, content, aliases) VALUES (?, ?, ?, ?)").run(
    blockId,
    title || "",
    content || "",
    aliasText,
  );
}

function clampLimit(limit, fallback = 20, max = 100) {
  return Math.min(Math.max(parseInt(limit, 10) || fallback, 1), max);
}

function tokenizeQuery(query) {
  return String(query || "")
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
}

function buildFtsQuery(query) {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t.replaceAll('"', '""')}"*`).join(" AND ");
}

function buildFtsOrQuery(query) {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return `"${tokens[0].replaceAll('"', '""')}"*`;
  return tokens.map((t) => `"${t.replaceAll('"', '""')}"*`).join(" OR ");
}

// Which indexed field explains the hit? Used for "why matched" chips.
function matchReason(queryTokens, aliasesText, tagsText) {
  const hay = (s) => String(s || "").toLowerCase();
  const hit = (text) =>
    queryTokens.some((t) => hay(text).split(/[^a-z0-9_]+/i).some((w) => w.startsWith(t)));
  if (hit(aliasesText)) return "alias";
  if (hit(tagsText)) return "tag";
  return "text";
}

const FTS_CONTEXT_COLS = `
  b.*, p.id AS page_id, p.title AS page_title,
  s.id AS source_id, s.title AS source_title,
  s.source_type AS source_type, s.url AS source_url,
  bm25(blocks_fts) AS rank,
  snippet(blocks_fts, 2, '<mark>', '</mark>', '…', 24) AS snippet,
  blocks_fts.aliases AS fts_aliases,
  (SELECT GROUP_CONCAT(tag, ' ') FROM tags WHERE block_id = b.id) AS block_tags,
  (SELECT GROUP_CONCAT(c.id || '|' || c.name, CHAR(31))
   FROM concept_links cl JOIN concepts c ON c.id = cl.concept_id
   WHERE cl.block_id = b.id) AS block_concepts`;

function runContextQuery(ftsQuery, limit) {
  return getDb()
    .prepare(
      `SELECT ${FTS_CONTEXT_COLS}
       FROM blocks_fts
       JOIN blocks b ON b.id = blocks_fts.block_id
       JOIN pages p ON p.id = b.page_id
       JOIN sources s ON s.id = p.source_id
       WHERE blocks_fts MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(ftsQuery, clampLimit(limit));
}

function toContextResult(r, matchType, queryTokens) {
  const concepts = String(r.block_concepts || "")
    .split("\x1f")
    .filter(Boolean)
    .map((part) => {
      const sep = part.indexOf("|");
      return sep === -1 ? null : { conceptId: part.slice(0, sep), name: part.slice(sep + 1) };
    })
    .filter(Boolean)
    .slice(0, 4);
  return {
    block: mapBlock(r),
    pageId: r.page_id,
    pageTitle: r.page_title,
    sourceId: r.source_id,
    sourceTitle: r.source_title,
    sourceType: r.source_type,
    sourceUrl: r.source_url,
    snippet: r.snippet || "",
    matchType,
    concepts,
    matchReason: matchReason(queryTokens, r.fts_aliases, r.block_tags),
    matchedTags: String(r.block_tags || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter((tag) =>
        queryTokens.some((t) => tag.toLowerCase().startsWith(t) || t.startsWith(tag.toLowerCase())),
      )
      .slice(0, 4),
  };
}

function searchBlocks(query, limit = 20) {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];
  return getDb()
    .prepare(
      `SELECT b.*, bm25(blocks_fts) AS rank FROM blocks_fts
       JOIN blocks b ON b.id = blocks_fts.block_id
       WHERE blocks_fts MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(ftsQuery, clampLimit(limit))
    .map((r) => mapBlock(r));
}

// FTS with page + source context for the search UI (one query, no N+1).
// Strategy is AND-then-OR: exact (all tokens) hits rank first; when AND
// yields fewer than `limit`, OR fills the rest so a query like
// "palantir impact" still surfaces palantir-blocks and impact-blocks.
// The OR pass is widened with concept-alias words (generic expansion through
// concept edges — no hardcoded terms): "FDE" also matches "forward deployed
// engineer". Each result carries matchType ('and'|'or'), a content snippet
// with <mark> highlights, and matchedTags for "why matched" chips.
function searchBlocksWithContext(query, limit = 20) {
  const andQuery = buildFtsQuery(query);
  if (!andQuery) return [];
  const tokens = tokenizeQuery(query);
  const max = clampLimit(limit);
  const andRows = runContextQuery(andQuery, max);
  const results = andRows.map((r) => toContextResult(r, "and", tokens));
  if (results.length < max && tokens.length >= 1) {
    const seen = new Set(andRows.map((r) => r.id));
    let orQuery = buildFtsOrQuery(query);
    try {
      const concepts = require("./concepts");
      const matched = concepts.findConceptsForTokens(tokens);
      const extra = concepts.conceptAliasWords(matched).filter((w) => !tokens.some((t) => w.startsWith(t) || t.startsWith(w)));
      if (extra.length > 0) {
        orQuery = `(${orQuery}) OR (${extra.map((w) => `"${w.replaceAll('"', '""')}"*`).join(" OR ")})`;
      }
    } catch {
      // concepts table unavailable → plain OR fallback
    }
    const orRows = runContextQuery(orQuery, max).filter((r) => !seen.has(r.id));
    for (const r of orRows) {
      if (results.length >= max) break;
      results.push(toContextResult(r, "or", tokens));
    }
  }
  return results;
}

function getPageTree(pageId) {
  const db = getDb();
  const page = db.prepare("SELECT * FROM pages WHERE id = ?").get(pageId);
  if (!page) return null;
  const blocks = db
    .prepare("SELECT * FROM blocks WHERE page_id = ? ORDER BY position ASC, created_at ASC")
    .all(pageId)
    .map(mapBlock);
  const tags = db
    .prepare("SELECT DISTINCT tag FROM tags WHERE block_id IN (SELECT id FROM blocks WHERE page_id = ?) ORDER BY tag")
    .all(pageId)
    .map((r) => r.tag);
  return {
    page: { id: page.id, sourceId: page.source_id, title: page.title },
    blocks,
    blockCount: blocks.length,
    tags,
  };
}

function countBlocks(pageId) {
  return getDb().prepare("SELECT COUNT(*) AS c FROM blocks WHERE page_id = ?").get(pageId).c;
}

module.exports = {
  createPage,
  getPageBySource,
  replacePageForSource,
  addBlock,
  addTag,
  normalizeTag,
  indexBlock,
  tokenizeQuery,
  buildFtsQuery,
  buildFtsOrQuery,
  searchBlocks,
  searchBlocksWithContext,
  getPageTree,
  countBlocks,
  mapBlock,
};
