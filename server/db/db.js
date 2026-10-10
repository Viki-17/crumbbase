// SQLite connection + pragmas (revamp P0).
// better-sqlite3 is synchronous: no buffering footguns like Mongoose —
// queries against a closed/missing DB throw immediately instead of hanging.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

let db = null;

function dataDir() {
  // Lazy-require config so tests can point DATA_DIR elsewhere before first use.
  const { config } = require("../config");
  return path.resolve(process.cwd(), config.dataDir);
}

function dbPath() {
  return path.join(dataDir(), "crumbbase.db");
}

function getDb() {
  if (db) return db;

  fs.mkdirSync(dataDir(), { recursive: true });
  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  // Auto-migrate on first open (learncache boots the same way).
  const { runMigrations } = require("./migrate");
  runMigrations(db);

  return db;
}

// Test/maintenance hook: close so a fresh DATA_DIR can be opened in-process.
function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore close errors in tests
    }
    db = null;
  }
}

function nowMs() {
  return Date.now();
}

module.exports = { getDb, closeDb, dataDir, dbPath, nowMs };
