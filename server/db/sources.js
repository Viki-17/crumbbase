// Sources + transcripts repository (revamp P1).
// Synchronous better-sqlite3: every call works or throws immediately.
// Rows are mapped to camelCase; JSON columns parsed with safe fallbacks.
const { randomUUID } = require("crypto");
const { getDb, nowMs } = require("./db");

const SOURCE_COLUMNS = new Set([
  "title", "creator", "duration_seconds", "thumbnail_url", "thumbnail_path",
  "status", "error", "starred", "source_type", "canonical_url",
]);

function mapSource(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    sourceType: row.source_type,
    title: row.title,
    creator: row.creator,
    durationSeconds: row.duration_seconds,
    thumbnailUrl: row.thumbnail_url,
    thumbnailPath: row.thumbnail_path,
    status: row.status,
    error: row.error,
    starred: row.starred === 1,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTranscript(row) {
  if (!row) return null;
  let segments = [];
  try {
    segments = JSON.parse(row.segments_json || "[]");
    if (!Array.isArray(segments)) segments = [];
  } catch {
    segments = [];
  }
  return {
    id: row.id,
    sourceId: row.source_id,
    text: row.text,
    segments,
    segmentCount: segments.length,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createSource({ url, canonicalUrl, sourceType }) {
  const now = nowMs();
  const row = {
    id: randomUUID(),
    url,
    canonical_url: canonicalUrl,
    source_type: sourceType,
    title: null, creator: null, duration_seconds: null,
    thumbnail_url: null, thumbnail_path: null,
    status: "queued", error: null, starred: 0, last_opened_at: null,
    created_at: now, updated_at: now,
  };
  try {
    getDb()
      .prepare(
        `INSERT INTO sources (id, url, canonical_url, source_type, title, creator,
          duration_seconds, thumbnail_url, thumbnail_path, status, error, starred,
          last_opened_at, created_at, updated_at)
         VALUES (@id, @url, @canonical_url, @source_type, @title, @creator,
          @duration_seconds, @thumbnail_url, @thumbnail_path, @status, @error, @starred,
          @last_opened_at, @created_at, @updated_at)`,
      )
      .run(row);
  } catch (err) {
    // UNIQUE race: two captures of the same URL at once — return the winner.
    if (String(err && err.message).includes("UNIQUE constraint failed")) {
      return findByCanonicalUrl(canonicalUrl);
    }
    throw err;
  }
  return mapSource(row);
}

function findByCanonicalUrl(canonicalUrl) {
  return mapSource(
    getDb().prepare("SELECT * FROM sources WHERE canonical_url = ?").get(canonicalUrl),
  );
}

function getSource(id) {
  return mapSource(getDb().prepare("SELECT * FROM sources WHERE id = ?").get(id));
}

function listSources({ status = "all", sourceType = "all", starred = "all", sort = "updated", query = "", limit = 50 } = {}) {
  const where = [];
  const params = [];
  if (status !== "all") {
    where.push("status = ?");
    params.push(status);
  }
  if (sourceType !== "all") {
    where.push("source_type = ?");
    params.push(sourceType);
  }
  if (starred !== "all") {
    where.push("starred = ?");
    params.push(starred === "1" || starred === 1 || starred === true ? 1 : 0);
  }
  const q = String(query || "").trim();
  if (q) {
    where.push("(title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR creator LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  // SQLite sorts NULLs last on DESC — unopened items sink naturally.
  const order = sort === "opened" ? "last_opened_at DESC, updated_at DESC" : "updated_at DESC";
  const sql = `SELECT * FROM sources${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ?`;
  params.push(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200));
  return getDb().prepare(sql).all(...params).map(mapSource);
}

function updateSource(id, patch) {
  const entries = Object.entries(patch || {}).filter(
    ([key, value]) => SOURCE_COLUMNS.has(key) && value !== undefined,
  );
  if (entries.length === 0) return getSource(id);
  const sets = entries.map(([key]) => `${key} = ?`).join(", ");
  getDb()
    .prepare(`UPDATE sources SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...entries.map(([, value]) => value), nowMs(), id);
  return getSource(id);
}

function touchOpened(id) {
  getDb()
    .prepare("UPDATE sources SET last_opened_at = ?, updated_at = ? WHERE id = ?")
    .run(nowMs(), nowMs(), id);
}

function upsertTranscript({ sourceId, text, segments, origin }) {
  const now = nowMs();
  const existing = getDb().prepare("SELECT * FROM transcripts WHERE source_id = ?").get(sourceId);
  const segmentsJson = JSON.stringify(segments || []);
  if (existing) {
    getDb()
      .prepare(
        "UPDATE transcripts SET text = ?, segments_json = ?, origin = ?, updated_at = ? WHERE id = ?",
      )
      .run(text, segmentsJson, origin, now, existing.id);
    return mapTranscript({ ...existing, text, segments_json: segmentsJson, origin, updated_at: now });
  }
  const row = {
    id: randomUUID(),
    source_id: sourceId,
    text,
    segments_json: segmentsJson,
    origin,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      "INSERT INTO transcripts (id, source_id, text, segments_json, origin, created_at, updated_at) VALUES (@id, @source_id, @text, @segments_json, @origin, @created_at, @updated_at)",
    )
    .run(row);
  return mapTranscript(row);
}

function getTranscript(sourceId) {
  return mapTranscript(
    getDb().prepare("SELECT * FROM transcripts WHERE source_id = ?").get(sourceId),
  );
}

function deleteSource(id) {
  getDb().prepare("DELETE FROM sources WHERE id = ?").run(id);
}

// Detail view: source + transcript + page/block counts + recent logs.
// Page/blocks arrive with the structure step (P1b); counts stay 0 until then.
function getSourcePreview(sourceId) {
  const db = getDb();
  const page = db.prepare("SELECT * FROM pages WHERE source_id = ?").get(sourceId) || null;
  if (!page) return { blockCount: 0, tldr: null, tags: [] };
  const blockCountRow = db.prepare("SELECT COUNT(*) AS c FROM blocks WHERE page_id = ?").get(page.id);
  const tldrRow = db
    .prepare("SELECT content FROM blocks WHERE page_id = ? AND json_extract(props_json, '$.kind') = 'tldr' ORDER BY position ASC LIMIT 1")
    .get(page.id);
  let tags = [];
  try {
    tags = db
      .prepare("SELECT DISTINCT tag FROM tags WHERE block_id IN (SELECT id FROM blocks WHERE page_id = ?) ORDER BY tag LIMIT 8")
      .all(page.id)
      .map((r) => r.tag);
  } catch {
    tags = [];
  }
  let tldr = tldrRow ? String(tldrRow.content || "") : null;
  if (tldr) {
    // Strip inline #tags for preview; keep body short.
    tldr = tldr.replace(/#[\w-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 220) || null;
  }
  return { blockCount: blockCountRow ? blockCountRow.c : 0, tldr, tags, pageId: page.id };
}

function listSourcesWithPreview(opts = {}) {
  const sources = listSources(opts);
  return sources.map((s) => ({ ...s, preview: getSourcePreview(s.id) }));
}
function getSourceDetail(id) {
  const db = getDb();
  const source = getSource(id);
  if (!source) return null;
  const transcript = getTranscript(id);
  const page = db.prepare("SELECT * FROM pages WHERE source_id = ?").get(id) || null;
  let blockCount = 0;
  if (page) {
    blockCount = db.prepare("SELECT COUNT(*) AS c FROM blocks WHERE page_id = ?").get(page.id).c;
  }
  const { getLogsForSource } = require("./jobs");
  return {
    ...source,
    transcript,
    page: page ? { id: page.id, title: page.title } : null,
    blockCount,
    logs: getLogsForSource(id, 50),
  };
}

module.exports = {
  createSource,
  findByCanonicalUrl,
  getSource,
  listSources,
  listSourcesWithPreview,
  getSourcePreview,
  updateSource,
  touchOpened,
  upsertTranscript,
  getTranscript,
  deleteSource,
  getSourceDetail,
};
