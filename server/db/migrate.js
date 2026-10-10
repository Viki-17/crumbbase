// Forward-only SQL migration runner (revamp P0).
// Applies server/db/migrations/*.sql in filename order, tracking versions in
// schema_migrations. Each file runs inside one transaction: any failure rolls
// the file back and aborts boot loudly (fail fast, never half-migrated).
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

function ensureMigrationsTable(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
}

function appliedVersions(db) {
  ensureMigrationsTable(db);
  return new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version),
  );
}

function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function runMigrations(db, { log = false } = {}) {
  const applied = appliedVersions(db);
  const apply = db.transaction((version, sql) => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
      version,
      Date.now(),
    );
  });

  let ran = 0;
  for (const file of migrationFiles()) {
    const version = path.basename(file, ".sql");
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    apply(version, sql);
    ran += 1;
    if (log) console.log(`[Migrate] applied ${version}`);
  }
  return ran;
}

function pendingMigrations(db) {
  const applied = appliedVersions(db);
  return migrationFiles()
    .map((f) => path.basename(f, ".sql"))
    .filter((v) => !applied.has(v));
}

module.exports = { runMigrations, pendingMigrations, MIGRATIONS_DIR };
