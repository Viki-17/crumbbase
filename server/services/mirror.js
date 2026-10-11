// Markdown mirror writer (revamp P1; OKF v0.2 profile since Oct 2026).
// Implements server/db/MARKDOWN_FORMAT.md: one OKF concept file per page under
// ./data/pages/<page-id>.md + data/manifest.json (sync clock) + bundle-root
// data/index.md (OKF progressive disclosure). The structure handler calls
// writePageMirror() right after writing blocks, so the safe copy is never
// more than one job behind the DB.
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { formatTimestamp } = require("../handlers/ingest");
const { dataDir } = require("../db/db");

// OKF v0.2 bundle markers (see MARKDOWN_FORMAT.md for the field mapping).
const OKF_VERSION = "0.2";
const OKF_TYPE_VIDEO = "Video Notes";

function pagesDir() {
  const dir = path.join(dataDir(), "pages");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function manifestPath() {
  return path.join(dataDir(), "manifest.json");
}

function youtubeDeepLink(url, seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  const sep = String(url).includes("?") ? "&" : "?";
  return `${url}${sep}t=${Math.floor(Number(seconds))}`;
}

function timestampLink(url, seconds) {
  const label = formatTimestamp(seconds);
  const link = youtubeDeepLink(url, seconds);
  if (!label || !link) return "";
  return ` [${label}](${link})`;
}

function frontmatter({ page, source, model, tags, description }) {
  // OKF v0.2 concept (§4.1): type is the only required key; recommended
  // title/description/resource/tags + provenance (sources) + trust
  // (generated) + lifecycle (status) families; crumbbase keys below the
  // marker comment are producer extensions (consumers must preserve them).
  // NOTE: `status` here is lifecycle (draft/stable) — the pipeline state
  // (queued/complete/...) lives in `pipeline_status`. They collided pre-OKF.
  const canonical = source.canonicalUrl || source.url;
  const doc = {
    type: OKF_TYPE_VIDEO,
    title: source.title || page.title || "Untitled",
    description: description || source.title || page.title || "Untitled",
    resource: canonical,
    tags: [...(tags || [])],
    sources: [
      {
        id: "video",
        resource: canonical,
        title: source.title || page.title || "Untitled",
        ...(source.creator ? { author: source.creator } : {}),
      },
    ],
    generated: { by: `crumbbase/${model || "mvp"}`, at: new Date().toISOString() },
    status: source.status === "complete" ? "stable" : "draft",
    // --- crumbbase extensions (sync identity + reimport fidelity) ---
    id: page.id,
    source_id: source.id,
    source_url: source.url,
    source_type: source.sourceType,
    ...(source.creator ? { creator: source.creator } : {}),
    ...(source.durationSeconds != null ? { duration_seconds: source.durationSeconds } : {}),
    pipeline_status: source.status,
  };
  return `---\n${yaml.dump(doc, { lineWidth: 160 })}---`;
}

// One-line summary for description/index entries: first sentence of the
// TL;DR with inline #tags stripped. Deterministic (no timestamps) so
// re-exports don't churn.
function describeTldr(tldr) {
  const clean = String(tldr || "").replace(/#[\w-]+/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const m = clean.match(/^(.{20,}?[.!?])(\s|$)/);
  const first = (m ? m[1] : clean).trim();
  return first.length > 220 ? `${first.slice(0, 220).trimEnd()}…` : first;
}

// Section contract with the structure handler: top-level blocks grouped by
// props.kind in this fixed order (position order preserved inside sections).
const SECTIONS = [
  { kind: "tldr", heading: "TL;DR", bullet: false },
  { kind: "key-idea", heading: "Key ideas", bullet: true },
  { kind: "claim", heading: "Notable claims", bullet: true },
  { kind: "question", heading: "Follow-up questions", bullet: true },
  { kind: "zettel", heading: "Zettels", bullet: true },
];

function renderBlockLine(block, sourceUrl) {
  const idComment = `<!-- block:${block.id} -->`;
  const ts = timestampLink(sourceUrl, block.props && block.props.timestamp);
  const aliases = ((block.props && block.props.aliases) || []).filter(Boolean);
  const aliasLine = aliases.length > 0 ? `\n  <!-- aliases: ${aliases.join("; ")} -->` : "";
  // Zettel → source-block link edge must survive a reimport (spec §Zettels):
  // without this comment the edge is silently dropped by the importer.
  const isZettel = block.props && block.props.kind === "zettel" && block.props.sourceBlockId;
  const sourceComment = isZettel ? ` <!-- source:${block.props.sourceBlockId} -->` : "";
  return `- ${block.content}${ts} ${idComment}${sourceComment}${aliasLine}`;
}

function renderMarkdown({ source, page, blocks, tags, concepts = [], model }) {
  const lines = [];
  const byKind = new Map();
  for (const b of blocks) {
    const kind = (b.props && b.props.kind) || "note";
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(b);
  }
  const tldrFirst = (byKind.get("tldr") || [])[0];
  lines.push(
    frontmatter({
      page,
      source,
      model,
      tags,
      description: describeTldr(tldrFirst && tldrFirst.content),
    }),
  );
  lines.push("", `# ${source.title || page.title || "Untitled"}`, "");
  lines.push("## Source", "");
  if (source.creator) lines.push(`- Creator: ${source.creator}`);
  if (source.sourceType) lines.push(`- Type: ${source.sourceType}`);
  if (source.durationSeconds != null) lines.push(`- Duration: ${formatTimestamp(source.durationSeconds)}`);
  lines.push(`- Source: [${source.url}](${source.url})`);
  if (source.canonicalUrl && source.canonicalUrl !== source.url) {
    lines.push(`- Canonical: [${source.canonicalUrl}](${source.canonicalUrl})`);
  }
  lines.push(`- Status: ${source.status}`);
  if (model) lines.push(`- Notes model: ${model}`);
  lines.push("");

  for (const section of SECTIONS) {
    const items = byKind.get(section.kind) || [];
    if (items.length === 0) continue;
    lines.push(`## ${section.heading}`, "");
    for (const b of items) {
      if (section.bullet) {
        lines.push(renderBlockLine(b, source.url));
      } else {
        lines.push(`${b.content} <!-- block:${b.id} -->`, "");
      }
    }
    if (items[items.length - 1] !== undefined && section.bullet) lines.push("");
  }

  // Tags live in frontmatter `tags:` (OKF §4.1) — no body section, single
  // source of truth. The importer still reads legacy ## Tags sections.

  // Export-only metadata (P2): concept edges live in the DB; reimport ignores
  // this section and rebuilds edges via entity linking on restructure.
  if (concepts.length > 0) {
    const seen = new Map();
    for (const c of concepts) {
      if (!seen.has(c.concept_id)) seen.set(c.concept_id, { name: c.name, count: 0 });
      seen.get(c.concept_id).count += 1;
    }
    lines.push("## Concepts", "");
    for (const { name, count } of [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- [[${name}]] (${count} note${count === 1 ? "" : "s"})`);
    }
    lines.push("");
  }

  const chunks = byKind.get("transcript-chunk") || [];
  if (chunks.length > 0) {
    lines.push("## Transcript", "");
    for (const b of chunks) lines.push(renderBlockLine(b, source.url));
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(), "utf8"));
  } catch {
    return { version: 1, exported_at: 0, pages: [] };
  }
}

function updateManifest(pageId, file) {
  const manifest = readManifest();
  const entry = { id: pageId, file, updated_at: Date.now() };
  const idx = manifest.pages.findIndex((p) => p.id === pageId);
  if (idx === -1) manifest.pages.push(entry);
  else manifest.pages[idx] = entry;
  manifest.exported_at = Date.now();
  fs.writeFileSync(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// Drop a manifest entry without touching the file (sync id-convergence:
// the hub id wins, the stale local id must not linger as a ghost entry).
function removeManifestEntry(pageId) {  const manifest = readManifest();
  const kept = (manifest.pages || []).filter((p) => p && p.id !== pageId);
  if (kept.length === (manifest.pages || []).length) return manifest;
  manifest.pages = kept;
  manifest.exported_at = Date.now();
  fs.writeFileSync(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// Delete a stale page mirror file (sync id-convergence counterpart to
// removeManifestEntry). ENOENT-safe; never touches the DB.
function removePageMirror(pageId) {
  try {
    fs.unlinkSync(path.join(pagesDir(), `${pageId}.md`));
    return true;
  } catch {
    return false;
  }
}

function writePageMirror(pageId, { model } = {}) {
  const sourcesRepo = require("../db/sources");
  const pagesRepo = require("../db/pages");

  const tree = pagesRepo.getPageTree(pageId);
  if (!tree) throw new Error(`writePageMirror: page ${pageId} not found`);
  const source = sourcesRepo.getSource(tree.page.sourceId);
  if (!source) throw new Error(`writePageMirror: source for page ${pageId} gone`);
  let concepts = [];
  try {
    concepts = require("../db/concepts").listConceptsForPage(pageId);
  } catch {
    concepts = [];
  }

  const markdown = renderMarkdown({ source, page: tree.page, blocks: tree.blocks, tags: tree.tags, concepts, model });
  const file = path.join(pagesDir(), `${pageId}.md`);
  fs.writeFileSync(file, markdown);
  updateManifest(pageId, `pages/${pageId}.md`);
  writeBundleIndex();
  return { file, bytes: Buffer.byteLength(markdown) };
}

// OKF bundle-root index.md (§8): progressive disclosure over the mirror.
// Regenerated wholesale from what's on disk (not the DB) so the committed
// file always matches the committed pages. carries okf_version — the only
// place frontmatter is permitted in an index file.
function writeBundleIndex() {
  const manifest = readManifest();
  const entries = [];
  for (const p of manifest.pages || []) {
    if (!p || !p.id || !p.file) continue;
    const abs = path.join(dataDir(), p.file);
    if (!abs.startsWith(`${pagesDir()}${path.sep}`)) continue; // stay inside pages/
    let title = p.id;
    let description = "";
    try {
      const text = fs.readFileSync(abs, "utf8");
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (m) {
        const fm = yaml.load(m[1]) || {};
        if (fm && typeof fm === "object") {
          if (fm.title) title = String(fm.title);
          if (fm.description) description = String(fm.description);
        }
      }
    } catch {
      // unreadable page — still list it by id
    }
    entries.push({ title, description, file: p.file });
  }
  entries.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const lines = ["---", `okf_version: "${OKF_VERSION}"`, "---", "", "# Crumbbase", ""];
  for (const e of entries) {
    lines.push(`* [${e.title}](${e.file})${e.description ? ` - ${e.description}` : ""}`);
  }
  lines.push("");
  const indexFile = path.join(dataDir(), "index.md");
  fs.writeFileSync(indexFile, `${lines.join("\n").trim()}\n`);
  return { file: indexFile, entries: entries.length };
}

module.exports = {
  writePageMirror,
  writeBundleIndex,
  renderMarkdown,
  describeTldr,
  updateManifest,
  removeManifestEntry,
  removePageMirror,
  readManifest,
  pagesDir,
  youtubeDeepLink,
  SECTIONS,
  OKF_VERSION,
  OKF_TYPE_VIDEO,
};
