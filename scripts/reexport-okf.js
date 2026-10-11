// Re-export every page in OKF v0.2 shape (flag-day script for the OKF switch).
// DB is untouched (mirror is derived) — safe to re-run; second run rewrites
// identical files except frontmatter `generated.at` timestamps.
// Usage: node scripts/reexport-okf.js  (respects DATA_DIR / .env)
const { getDb, closeDb } = require("../server/db/db");
const mirror = require("../server/services/mirror");

function main() {
  const db = getDb();
  const pages = db.prepare("SELECT id FROM pages ORDER BY created_at ASC").all();
  let ok = 0;
  const failed = [];
  for (const p of pages) {
    try {
      mirror.writePageMirror(p.id, {});
      ok += 1;
    } catch (err) {
      failed.push({ page: p.id, error: err && err.message ? err.message : String(err) });
    }
  }
  try {
    const index = mirror.writeBundleIndex();
    console.log(`index.md: ${index.entries} entries`);
  } catch (err) {
    failed.push({ page: "(index)", error: err && err.message ? err.message : String(err) });
  }
  console.log(`re-exported ${ok}/${pages.length} pages`);
  for (const f of failed) console.log(`FAILED ${f.page}: ${f.error}`);
  closeDb();
  if (failed.length > 0) process.exit(1);
}

main();
