// Dev Core course reader serves verbatim copies of SingleFile-saved HTML
// document packs under <DATA_DIR>/hurry-course/ (gitignored, never committed,
// never mirrored). Lesson metadata is derived from the filename + the
// url-comment each SingleFile page carries in its first bytes; the HTML files
// themselves are never written or transformed — /course/raw streams the exact
// file bytes, /course/lessons reads only the first 64KB of each file.
const fs = require("fs");
const path = require("path");
const { dataDir } = require("../db/db");

const COURSE_SUBDIR = "hurry-course";
const HEAD_BYTES = 65536;

function courseDir() {
  return path.join(dataDir(), COURSE_SUBDIR);
}

function prettyGroup(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// Filename → display title. Saved names look like
// "013 Design a URL Shortener Like Bit.ly ｜ Hello Interview System Design in a Hurry.html"
// Grill saves look like "data-modelling-grill.html" — dashes become spaces
// and all-lowercase names get Title Cased ("Data Modelling Grill").
// Mixed-case names are left alone so existing lessons are untouched.
function lessonMeta(rel, filename) {
  const base = filename.replace(/\.html?$/i, "");
  const numMatch = base.match(/^(\d{1,4})[\s._-]+/);
  const rest = numMatch ? base.slice(numMatch[0].length) : base;
  const cut = rest.split(/｜|\s\|\s/)[0].trim();
  let title = cut || rest || base;
  // Grill saves are all-lowercase dashed ("data-modelling-grill") — humanize
  // to "Data Modelling Grill". Mixed-case names (existing lessons, where
  // hyphens like "Real-time" are meaningful) are left byte-alone.
  if (title && title === title.toLowerCase()) {
    title = title
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return {
    num: numMatch ? numMatch[1] : null,
    title,
  };
}

// Read the SingleFile save-comment in the first bytes:  <!--  url: https://… -->
function savedUrl(abs) {
  try {
    const fd = fs.openSync(abs, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    let head = "";
    try {
      const got = fs.readSync(fd, buf, 0, buf.length, 0);
      head = buf.toString("utf8", 0, got);
    } finally {
      fs.closeSync(fd);
    }
    const m = head.match(/\burl:\s*(\S+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function groupLessons(label, dirPath, dirName, idPrefix) {
  let names;
  try {
    names = fs.readdirSync(dirPath);
  } catch {
    return [];
  }
  const files = names
    .filter((f) => f.toLowerCase().endsWith(".html") && !f.startsWith("."))
    .sort();
  const lessons = [];
  for (const f of files) {
    const abs = path.join(dirPath, f);
    let size = null;
    try {
      size = fs.statSync(abs).size;
    } catch {
      size = null;
    }
    const meta = lessonMeta(dirName, f);
    const id = (idPrefix ? idPrefix + "/" : "") + f.replace(/\.html?$/i, "");
    lessons.push({
      id,
      group: label,
      num: meta.num,
      title: meta.title,
      url: savedUrl(abs),
      size,
    });
  }
  return lessons;
}

let cache = null; // { key, payload }

function listLessons() {
  const root = courseDir();
  let rootEntries;
  let rootMtime;
  try {
    const st = fs.statSync(root);
    if (!st.isDirectory()) return { available: false, groups: [] };
    rootMtime = st.mtimeMs;
    rootEntries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { available: false, groups: [] };
  }

  const subdirs = rootEntries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => {
      const p = path.join(root, e.name);
      let mtime = 0;
      try {
        mtime = fs.statSync(p).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { name: e.name, mtime };
    });
  const key = JSON.stringify({ root: rootMtime, subdirs });
  if (cache && cache.key === key) return cache.payload;

  const groups = [
    {
      name: "Lessons",
      lessons: groupLessons("Lessons", root, null, null),
    },
  ];
  // Subfolders (e.g. save-pack update drops) become their own groups.
  for (const sub of subdirs.sort((a, b) => a.name.localeCompare(b.name))) {
    const label = prettyGroup(sub.name);
    groups.push({
      name: label,
      lessons: groupLessons(label, path.join(root, sub.name), sub.name, sub.name),
    });
  }
  const payload = { available: true, groups: groups.filter((g) => g.lessons.length) };
  cache = { key, payload };
  return payload;
}

// Map a lesson id ("UPDATES JAN 2026/Caching…" or "013 Design a URL …")
// to the absolute file path. Rejects anything that escapes the course dir.
function resolveLessonPath(id) {
  if (typeof id !== "string" || !id.trim() || id.includes("\0") || id.includes("\\")) {
    return null;
  }
  const expectedSegments = id.split("/").length;
  const rel = id.split("/").filter((s) => s && s !== "." && s !== "..");
  if (!rel.length || rel.length !== expectedSegments) return null;
  const absDir = path.resolve(courseDir()) + path.sep;
  const abs = path.resolve(path.join(absDir, ...rel) + ".html");
  if (!abs.startsWith(absDir)) return null;
  try {
    if (!fs.statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  return abs;
}

module.exports = { listLessons, resolveLessonPath, courseDir };
