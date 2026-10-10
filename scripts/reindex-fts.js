// Reindex FTS rows so old pages gain P2a recall (tags + concept names in the
// aliases column). Idempotent: every FTS row is rebuilt from scratch.
// Usage: node scripts/reindex-fts.js  (respects DATA_DIR / .env)
const { getDb, closeDb } = require("../server/db/db");
const pagesRepo = require("../server/db/pages");

const NOTE_KINDS = new Set(["tldr", "key-idea", "claim", "question", "zettel"]);

function main() {
  const db = getDb();
  const pages = db.prepare("SELECT id, title FROM pages").all();
  let blocks = 0;
  let withTags = 0;
  let withConcepts = 0;
  for (const page of pages) {
    const rows = db.prepare("SELECT * FROM blocks WHERE page_id = ?").all(page.id).map(pagesRepo.mapBlock);
    for (const b of rows) {
      const kind = (b.props && b.props.kind) || "";
      const blockTags = db.prepare("SELECT tag FROM tags WHERE block_id = ?").all(b.id).map((r) => r.tag);
      let conceptNames = [];
      try {
        conceptNames = db
          .prepare("SELECT c.name FROM concept_links cl JOIN concepts c ON c.id = cl.concept_id WHERE cl.block_id = ?")
          .all(b.id)
          .map((r) => r.name);
      } catch {
        // concepts table missing (shouldn't happen post-migration) — skip
      }
      if (NOTE_KINDS.has(kind)) {
        if (blockTags.length > 0) withTags += 1;
        if (conceptNames.length > 0) withConcepts += 1;
        pagesRepo.indexBlock({
          blockId: b.id,
          title: page.title,
          content: b.content,
          aliases: [...(b.props.aliases || []), ...conceptNames],
          tags: blockTags,
        });
      } else {
        pagesRepo.indexBlock({
          blockId: b.id,
          title: page.title,
          content: b.content,
          aliases: b.props.aliases || [],
          tags: [],
        });
      }
      blocks += 1;
    }
  }
  console.log(`Reindexed ${blocks} blocks across ${pages.length} pages (${withTags} with tags, ${withConcepts} with concepts).`);
  closeDb();
}

if (require.main === module) main();

module.exports = {};
