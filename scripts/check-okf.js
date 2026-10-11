// OKF conformance self-check over ./data (§11 of the OKF v0.2 spec).
// Asserts: every non-reserved .md parses as YAML frontmatter with non-empty
// `type`; bundle-root index.md carries okf_version + resolving entries;
// our required extension keys (id, source_url) present for sync identity.
// Usage: node scripts/check-okf.js [--strict]  (respects DATA_DIR / .env)
// Exit 0 = conformant, 1 = violations listed. --strict also fails on unknown
// `type` values (default: tolerated per spec).
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { dataDir } = require("../server/db/db");

const strict = process.argv.includes("--strict");
const KNOWN_TYPES = new Set(["Video Notes"]);

function frontmatterOf(file) {
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { error: "no frontmatter block" };
  try {
    const doc = yaml.load(m[1]);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { error: "frontmatter not a mapping" };
    return { doc };
  } catch (err) {
    return { error: `YAML parse: ${err.message.slice(0, 100)}` };
  }
}

function main() {
  const dir = dataDir();
  const pagesDir = path.join(dir, "pages");
  const violations = [];
  const files = fs.existsSync(pagesDir)
    ? fs.readdirSync(pagesDir).filter((f) => f.endsWith(".md"))
    : [];
  if (files.length === 0) violations.push("(pages/) no concept files found");

  for (const f of files) {
    const { doc, error } = frontmatterOf(path.join(pagesDir, f));
    if (error) {
      violations.push(`${f}: ${error}`);
      continue;
    }
    if (!doc.type || !String(doc.type).trim()) violations.push(`${f}: missing non-empty type`);
    else if (strict && !KNOWN_TYPES.has(String(doc.type))) violations.push(`${f}: unknown type ${doc.type}`);
    if (!doc.id) violations.push(`${f}: missing extension key id (sync identity)`);
    if (!doc.source_url && !doc.resource) violations.push(`${f}: missing source_url/resource`);
    if (doc.status != null && !["draft", "stable", "deprecated"].includes(String(doc.status))) {
      violations.push(`${f}: lifecycle status must be draft/stable/deprecated, got ${doc.status}`);
    }
    if (doc.generated != null) {
      const at = doc.generated.at;
      const ms = at instanceof Date ? at.getTime() : Date.parse(at);
      if (!Number.isFinite(ms)) violations.push(`${f}: generated.at not ISO-8601 (${at})`);
    }
  }

  const indexFile = path.join(dir, "index.md");
  if (!fs.existsSync(indexFile)) {
    violations.push("index.md missing at bundle root");
  } else {
    const { doc, error } = frontmatterOf(indexFile);
    if (error && !/no frontmatter block/.test(error)) violations.push(`index.md: ${error}`);
    else if (doc && doc.okf_version !== "0.2") violations.push(`index.md: okf_version should be "0.2"`);
    const text = fs.readFileSync(indexFile, "utf8");
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
    const links = [...body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
    if (links.length === 0) violations.push("index.md: no entries");
    for (const href of links) {
      const target = path.normalize(path.join(dir, href.split("#")[0]));
      if (!target.startsWith(dir) || !fs.existsSync(target)) {
        violations.push(`index.md: entry target missing: ${href}`);
      }
    }
  }

  if (violations.length === 0) {
    console.log(`OKF conformant: ${files.length} concepts + index.md`);
  } else {
    for (const v of violations) console.log(`VIOLATION ${v}`);
    process.exit(1);
  }
}

main();
