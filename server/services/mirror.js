// Markdown mirror writer (revamp P1).
// Implements server/db/MARKDOWN_FORMAT.md: one file per page under
// ./data/pages/<page-id>.md + data/manifest.json. The structure handler calls
// writePageMirror() right after writing blocks, so the safe copy is never
// more than one job behind the DB.
const fs = require("fs");
const path = require("path");
const { formatTimestamp } = require("../handlers/ingest");
const { dataDir } = require("../db/db");

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

function frontmatter({ page, source, model }) {
  const lines = [
    "---",
    `id: ${page.id}`,
    `source_id: ${source.id}`,
    `source_url: ${source.url}`,
    `source_type: ${source.sourceType}`,
    `title: ${JSON.stringify(source.title || page.title || "Untitled")}`,
    `creator: ${JSON.stringify(source.creator || "")}`,
    `duration_seconds: ${source.durationSeconds == null ? "" : source.durationSeconds}`,
    `status: ${source.status}`,
    `notes_model: ${model || ""}`,
    `exported_at: ${Date.now()}`,
    "---",
  ];
  return lines.join("\n");
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
  return `- ${block.content}${ts} ${idComment}${aliasLine}`;
}

function renderMarkdown({ source, page, blocks, tags, concepts = [], model }) {
  const lines = [];
  lines.push(frontmatter({ page, source, model }));
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

  const byKind = new Map();
  for (const b of blocks) {
    const kind = (b.props && b.props.kind) || "note";
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(b);
  }

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

  if (tags.length > 0) {
    lines.push("## Tags", "", tags.map((t) => `#${t}`).join(" "), "");
  }

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
  return { file, bytes: Buffer.byteLength(markdown) };
}

module.exports = {
  writePageMirror,
  renderMarkdown,
  updateManifest,
  readManifest,
  pagesDir,
  youtubeDeepLink,
  SECTIONS,
};
