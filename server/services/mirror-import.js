// Mirror importer: Markdown mirror → SQLite (P2 hub sync).
// Implements the parser half of server/db/MARKDOWN_FORMAT.md ("reimportable").
// Cross-machine identity is the source canonical URL — page/block UUIDs are
// per-machine, so sync matches on canonical_url and never on page id.
// Block ids from <!-- block:uuid --> ARE reused (spec rule 1) so re-export is
// stable and hub diffs stay minimal; bullets without ids get fresh UUIDs.
//
// Known-lossy (documented, not silent): transcript segment durations are not
// in the mirror (only t= seconds — approximated from the next segment start),
// zettel card tags are not in the mirror (page tags only), and concept edges
// are rebuilt by a queued link_index job rather than carried over.
const { randomUUID } = require("crypto");
const yaml = require("js-yaml");
const { getDb, nowMs } = require("../db/db");
const { normalizeCaptureUrl } = require("../lib/urls");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMENT_RE = /<!--\s*([\w-]+)\s*:\s*(.*?)\s*-->/g;
const TS_LINK_RE = /\[([^\]]*)\]\(([^)]*)\)\s*$/;
const ZETTEL_RE = /^\*\*(.+?):\*\*\s*([\s\S]*)$/;
const VALID_STATUSES = new Set(["queued", "fetching", "awaiting_paste", "processing", "complete", "failed"]);
const VALID_SOURCE_TYPES = new Set(["youtube", "podcast", "blog", "book", "unknown"]);

function asUuidOrFresh(value) {
  const v = String(value || "").trim();
  return UUID_RE.test(v) ? v : randomUUID();
}

function parseFrontmatter(text) {
  const m = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error("Mirror page has no frontmatter block.");
  let front;
  try {
    front = yaml.load(m[1]);
  } catch (err) {
    throw new Error(`Mirror frontmatter is not valid YAML: ${err.message.slice(0, 120)}`);
  }
  if (!front || typeof front !== "object" || Array.isArray(front)) {
    throw new Error("Mirror frontmatter must be a key/value mapping.");
  }
  if (front.okf_version != null && (front.id == null || front.source_url == null)) {
    throw new Error("Reserved bundle file (index/log), not a concept — skipping.");
  }
  if (front.id == null || front.source_url == null) {
    throw new Error("Mirror frontmatter missing id or source_url.");
  }
  return { front, body: String(text).slice(m[0].length) };
}

// Newer-wins clock: OKF `generated.at` (ISO string, epoch, or YAML Date),
// falling back to legacy `exported_at` epoch so pre-switch hub copies still
// compare correctly during the flag-day window.
function frontmatterTimeMs(front) {
  try {
    const at = front && front.generated && front.generated.at;
    if (at instanceof Date) {
      const ms = at.getTime();
      if (Number.isFinite(ms)) return ms;
    } else if (typeof at === "number" && Number.isFinite(at)) {
      return at < 1e12 ? at * 1000 : at;
    } else if (typeof at === "string" && at.trim()) {
      const ms = Date.parse(at.trim());
      if (Number.isFinite(ms)) return ms;
    }
  } catch {
    // fall through to legacy
  }
  return Number(front.exported_at) || 0;
}

// Pipeline status: renamed `pipeline_status` in the OKF switch. Legacy
// mirrors carry pipeline values under `status`; OKF lifecycle values map
// stable→complete, draft→processing.
function frontmatterPipelineStatus(front) {
  if (VALID_STATUSES.has(front.pipeline_status)) return front.pipeline_status;
  if (VALID_STATUSES.has(front.status)) return front.status; // legacy
  if (front.status === "stable" || front.status === "deprecated") return "complete";
  if (front.status === "draft") return "processing";
  return "complete";
}

function timestampFromUrl(url) {
  try {
    const t = new URL(String(url)).searchParams.get("t");
    const n = Math.floor(Number(t));
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

// One bullet (or TL;DR paragraph line) → { content, blockId, sourceBlockId,
// aliases, timestamp }. Trailing comments and the renderer's timestamp link
// are stripped; everything else is content, verbatim.
function parseBulletLine(line) {
  let rest = line;
  const comments = {};
  rest = rest.replace(COMMENT_RE, (_, key, value) => {
    if (key === "block" && comments.block == null) comments.block = String(value).trim();
    else if (key === "source" && comments.source == null) comments.source = String(value).trim();
    return "";
  });
  let timestamp = null;
  const tsMatch = rest.match(TS_LINK_RE);
  if (tsMatch && String(tsMatch[2]).includes("t=")) {
    const parsed = timestampFromUrl(tsMatch[2]);
    if (parsed != null) {
      timestamp = parsed;
      rest = rest.slice(0, tsMatch.index).trimEnd();
    }
  }
  return {
    content: rest.trim(),
    blockId: comments.block ? asUuidOrFresh(comments.block) : randomUUID(),
    sourceBlockId: comments.source && UUID_RE.test(comments.source.trim()) ? comments.source.trim() : null,
    aliases: [],
    timestamp,
  };
}

const SECTION_KIND = {
  "tl;dr": "tldr",
  "key ideas": "key-idea",
  "notable claims": "claim",
  "follow-up questions": "question",
  zettels: "zettel",
  transcript: "transcript-chunk",
  tags: "tags", // metadata section (no blocks); null would wrongly skip it
};

function blankBullet(kind) {
  return { content: "", blockId: randomUUID(), sourceBlockId: null, aliases: [], timestamp: null, kind };
}

// Parse the mirror body into ordered sections. Nested `- ` bullets (2-space
// indent per level) become children via parentId indexes resolved at insert.
function parseSections(body) {
  const sections = [];
  let current = null;
  let lastBullet = null;
  const push = () => {
    if (current && (current.bullets.length > 0 || current.kind === "tags")) sections.push(current);
  };
  for (const rawLine of String(body || "").split(/\r?\n/)) {
    const heading = rawLine.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      push();
      const name = heading[1].trim().toLowerCase();
      current = { name, kind: SECTION_KIND[name] || null, bullets: [], tags: [] };
      lastBullet = null;
      continue;
    }
    if (!current || current.kind === null) continue; // ## Source / ## Concepts / unknown: skipped
    if (current.name === "tags") {
      for (const tok of rawLine.trim().split(/\s+/)) {
        if (tok.startsWith("#") && tok.length > 1) current.tags.push(tok);
      }
      continue;
    }
    if (/^\s*<!--\s*aliases\s*:/.test(rawLine) && lastBullet) {
      const aliasText = rawLine.replace(/^\s*<!--\s*aliases\s*:/, "").replace(/-->\s*$/, "");
      lastBullet.aliases = aliasText.split(";").map((a) => a.trim()).filter(Boolean);
      continue;
    }
    const bullet = rawLine.match(/^(\s*)-\s([\s\S]*)$/);
    if (bullet) {
      const level = Math.floor(bullet[1].length / 2);
      const parsed = parseBulletLine(bullet[2]);
      parsed.kind = current.kind;
      parsed.level = level;
      current.bullets.push(parsed);
      lastBullet = parsed;
      continue;
    }
    if (current.kind === "tldr" && rawLine.trim()) {
      // TL;DR renders as a paragraph line, not a bullet.
      const parsed = parseBulletLine(rawLine.trim());
      parsed.kind = "tldr";
      parsed.level = 0;
      current.bullets.push(parsed);
      lastBullet = parsed;
    }
  }
  push();
  return sections;
}

function parsePageMarkdown(markdown) {
  const { front, body } = parseFrontmatter(markdown);
  return { front, sections: parseSections(body) };
}

function sectionTags(sections, front, normalizeTag) {
  // OKF frontmatter `tags:` is authoritative; legacy ## Tags section tokens
  // merge in (deduped) so pre-switch mirrors import losslessly.
  const tags = [];
  const take = (raw) => {
    const clean = normalizeTag(raw);
    if (clean && !tags.includes(clean)) tags.push(clean);
  };
  if (Array.isArray(front.tags)) for (const t of front.tags) take(t);
  for (const s of sections) {
    if (s.name !== "tags") continue;
    for (const tok of s.tags) take(tok);
  }
  return tags;
}

// FTS content mirrors what structure.js indexes (plain label+summary for
// ideas, title+body for zettels) — not the **markdown** stored in content.
function ftsContentFor(block) {
  const kind = block.props && block.props.kind;
  if (kind === "key-idea" || kind === "zettel") {
    return String(block.content || "").replace(/^\*\*(.+?):\*\*\s*/, "$1 ").trim();
  }
  return block.content;
}

// Full import (or newer-wins replace) of one mirror page. Returns
// { action: 'imported'|'updated'|'skipped', pageId, sourceId, blockCount }.
function importPageMarkdown(markdown) {
  const pagesRepo = require("../db/pages");
  const sourcesRepo = require("../db/sources");
  const mirror = require("./mirror");

  const { front, sections } = parsePageMarkdown(markdown);
  const normalized = normalizeCaptureUrl(String(front.source_url));
  const canonicalUrl = normalized.canonicalUrl;
  const sourceType = VALID_SOURCE_TYPES.has(front.source_type)
    ? front.source_type
    : normalized.sourceType || "unknown";

  const existing = sourcesRepo.findByCanonicalUrl(canonicalUrl);
  let localUpdatedAt = 0;
  let existingPageId = null;
  if (existing) {
    const page = pagesRepo.getPageBySource(existing.id);
    existingPageId = page ? page.id : null;
    if (existingPageId) {
      const manifest = mirror.readManifest();
      const entry = (manifest.pages || []).find((p) => p.id === existingPageId);
      localUpdatedAt = entry ? Number(entry.updated_at) || 0 : 0;
    }
  }

  const hubTime = frontmatterTimeMs(front);
  if (existing) {
    if (hubTime <= localUpdatedAt) {
      return { action: "skipped", pageId: existingPageId, sourceId: existing.id, blockCount: 0 };
    }
  }

  // No count cap (unlike structure.js's AI-output budget): the tags table has
  // no limit and slicing would silently drop legacy tags on reimport.
  const tags = sectionTags(sections, front, pagesRepo.normalizeTag);
  const title = String(front.title || "Untitled") || "Untitled";
  const creator = String(front.creator || "") || null;
  const durationSeconds = front.duration_seconds === "" || front.duration_seconds == null
    ? null
    : Math.floor(Number(front.duration_seconds));
  const status = frontmatterPipelineStatus(front);

  const noteSections = sections.filter((s) => s.kind && s.kind !== "tags");
  const chunks = sections.find((s) => s.kind === "transcript-chunk");
  const chunkBullets = chunks ? chunks.bullets : [];
  const origin = chunkBullets.some((b) => b.timestamp != null) ? "caption" : "paste";
  const transcriptText = chunkBullets.map((b) => b.content).join(" ").trim();
  const segments = chunkBullets.map((b, i) => {
    const start = b.timestamp != null ? b.timestamp : i;
    const next = chunkBullets[i + 1];
    const end = next && next.timestamp != null && next.timestamp > start ? next.timestamp : start + 5;
    return { start, end, text: b.content };
  });

  const db = getDb();
  const now = nowMs();
  const insertSource = db.prepare(
    `INSERT INTO sources (id, url, canonical_url, source_type, title, creator,
      duration_seconds, thumbnail_url, thumbnail_path, status, error, starred,
      last_opened_at, created_at, updated_at)
     VALUES (@id, @url, @canonical_url, @source_type, @title, @creator,
      @duration_seconds, @thumbnail_url, @thumbnail_path, @status, @error, @starred,
      @last_opened_at, @created_at, @updated_at)`,
  );
  // Reuse the origin machine's source/page ids (frontmatter) so hub manifest
  // ids stay aligned across machines; block ids come from block comments.
  // Always adopt the hub's page id: two machines that captured the same
  // URL independently converge on one id instead of accumulating parallel
  // manifest entries forever. Source ids stay local (UI routes by source).
  const sourceId = existing ? existing.id : String(front.source_id || "").trim() || randomUUID();
  const pageId = String(front.id || "").trim() || randomUUID();
  const sourceRow = {
    id: sourceId,
    url: String(front.source_url),
    canonical_url: canonicalUrl,
    source_type: sourceType,
    title,
    creator,
    duration_seconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    thumbnail_url: null,
    thumbnail_path: null,
    status,
    error: null,
    starred: 0,
    last_opened_at: null,
    created_at: now,
    updated_at: now,
  };

  // Flattened insert list with nesting resolved to parent ids. Position runs
  // globally in file order (same convention as structure.js).
  const pending = [];
  {
    let position = 0;
    const stack = [];
    const zettelLinks = [];
    for (const section of noteSections) {
      for (const b of section.bullets) {
        if (!b.content && section.kind !== "tldr") continue;
        const props = { kind: section.kind };
        if (b.timestamp != null) props.timestamp = b.timestamp;
        if (b.aliases.length > 0) props.aliases = [...new Set(b.aliases)].slice(0, 5);
        if (section.kind === "zettel") {
          const zm = b.content.match(ZETTEL_RE);
          props.zettelTitle = zm ? zm[1].trim().slice(0, 80) : b.content.slice(0, 80);
          if (b.sourceBlockId) {
            props.sourceBlockId = b.sourceBlockId;
            zettelLinks.push([b.blockId, b.sourceBlockId]);
          }
        }
        const level = Math.min(b.level || 0, stack.length);
        stack.length = level;
        const parentId = level > 0 ? stack[level - 1] : null;
        pending.push({ id: b.blockId, parentId, position: position++, content: b.content, props });
        stack[level] = b.blockId;
      }
    }
    pending.zettelLinks = zettelLinks;
  }

  const run = db.transaction(() => {
    // Prod safety: stash link_state before the cascade delete and restore
    // after (same page id — frontmatter ids are reused). Content-identical
    // re-imports then hit the link_index fingerprint gate and skip AI work;
    // genuinely changed pages fingerprint differently and relink fully.
    let stashedLinkState = null;
    if (existing && existingPageId) {
      try {
        stashedLinkState = db.prepare("SELECT * FROM link_state WHERE page_id = ?").get(existingPageId) || null;
      } catch {
        stashedLinkState = null;
      }
    }
    if (existing) {
      // Newer-wins replace: wipe FTS rows explicitly (not FK-managed), then
      // cascade-delete the source tree (pages/blocks/tags/links/transcript).
      const oldIds = db.prepare("SELECT id FROM blocks WHERE page_id = ?").all(existingPageId);
      const delFts = db.prepare("DELETE FROM blocks_fts WHERE block_id = ?");
      for (const r of oldIds) delFts.run(r.id);
      db.prepare("DELETE FROM sources WHERE id = ?").run(existing.id);
    }
    insertSource.run(sourceRow);
    sourcesRepo.upsertTranscript({ sourceId, text: transcriptText, segments, origin });
    pagesRepo.createPage({ sourceId, title, id: pageId });
    const insertBlock = db.prepare(
      "INSERT INTO blocks (id, page_id, parent_id, position, content, props_json, created_at, updated_at) VALUES (@id, @page_id, @parent_id, @position, @content, @props_json, @created_at, @updated_at)",
    );
    const insertTag = db.prepare("INSERT OR IGNORE INTO tags (block_id, tag) VALUES (?, ?)");
    const insertLink = db.prepare("INSERT INTO links (id, from_block_id, to_block_id, created_at) VALUES (?, ?, ?, ?)");
    const insertedIds = new Set();
    for (const p of pending) {
      insertBlock.run({
        id: p.id,
        page_id: pageId,
        parent_id: p.parentId,
        position: p.position,
        content: p.content,
        props_json: JSON.stringify(p.props),
        created_at: now,
        updated_at: now,
      });
      insertedIds.add(p.id);
      // Tags table mirrors structure.js exactly: page tags attach to tldr +
      // key-idea blocks only; claims/questions/chunks carry tags in FTS.
      if (p.props.kind === "tldr" || p.props.kind === "key-idea") {
        for (const t of tags) insertTag.run(p.id, t);
      }
      const ftsTags = p.props.kind === "transcript-chunk" || p.props.kind === "zettel" ? [] : tags;
      pagesRepo.indexBlock({
        blockId: p.id,
        title,
        content: ftsContentFor({ content: p.content, props: p.props }),
        aliases: p.props.aliases || [],
        tags: ftsTags,
      });
    }
    for (const [from, to] of pending.zettelLinks || []) {
      if (!insertedIds.has(to)) continue; // dangling source ref — keep card, skip edge
      try {
        insertLink.run(randomUUID(), from, to, now);
      } catch {
        // duplicate/edge race — card is already stored
      }
    }
    if (stashedLinkState) {
      db.prepare(
        "INSERT OR REPLACE INTO link_state (page_id, fingerprint, links_written, ran_at) VALUES (?, ?, ?, ?)",
      ).run(pageId, stashedLinkState.fingerprint, stashedLinkState.links_written, stashedLinkState.ran_at);
    }
  });
  run();

  // Local mirror + manifest refresh (drives the newer-wins clock), then
  // concept edges rebuild via the same safety-net path structure.js uses.
  // On id change (converged onto the hub id) drop the stale local entry so
  // the manifest never lists a page file that no longer exists.
  mirror.writePageMirror(pageId, {});
  if (existingPageId && existingPageId !== pageId) {
    try {
      mirror.removeManifestEntry(existingPageId);
      mirror.removePageMirror(existingPageId);
      mirror.writeBundleIndex();
    } catch {
      // stale entry is cosmetic — sync matching is by canonical URL
    }
  }
  require("../db/jobs").enqueueJob({ type: "link_index", sourceId, payload: {} });

  return {
    action: existing ? "updated" : "imported",
    pageId,
    sourceId,
    blockCount: pending.length,
  };
}

module.exports = {
  parsePageMarkdown,
  parseFrontmatter,
  parseSections,
  importPageMarkdown,
};
