// One-shot convergence after the Follow-up questions drop (Oct 2026).
// The 007 migration purges question blocks from the DB on boot; this script
// rewrites every page mirror so committed markdown drops the section too.
// Idempotent: re-running rewrites identical files (block ids are stable).
// Usage: node scripts/purge-questions.js  (respects DATA_DIR / .env;
// run from the repo root on the machine holding ./data)
const { getDb, closeDb, dataDir } = require("../server/db/db");

function main() {
  const db = getDb(); // auto-runs pending migrations (incl. 007) first
  const qCount = db
    .prepare("SELECT COUNT(*) AS c FROM blocks WHERE props_json LIKE '%\"kind\":\"question\"%'")
    .get().c;
  if (qCount > 0) {
    // Belt and suspenders (migration should have handled this): FTS first,
    // then blocks; tags/links/concept edges cascade via FK.
    db.prepare(
      "DELETE FROM blocks_fts WHERE block_id IN (SELECT id FROM blocks WHERE props_json LIKE '%\"kind\":\"question\"%')",
    ).run();
    const wiped = db.prepare("DELETE FROM blocks WHERE props_json LIKE '%\"kind\":\"question\"%'").run();
    console.log(`purged ${wiped.changes} leftover question blocks`);
  } else {
    console.log("no question blocks in DB (migration already purged)");
  }
  const mirror = require("../server/services/mirror");
  const pages = db.prepare("SELECT id FROM pages").all();
  let rewritten = 0;
  for (const p of pages) {
    try {
      mirror.writePageMirror(p.id, {});
      rewritten += 1;
    } catch (err) {
      console.error(`skip ${p.id}: ${err && err.message ? err.message : err}`);
    }
  }
  console.log(`mirrors rewritten: ${rewritten} (data dir: ${dataDir()})`);
  closeDb();
}

main();
