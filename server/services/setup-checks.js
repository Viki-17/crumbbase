// P0 health checks for setup/status: SQLite, media tools, backup (revamp).
// Everything here is synchronous and never throws — a health endpoint must
// report, not hang (better-sqlite3 throws immediately on a bad DB instead of
// buffering like Mongoose, so no readyState guards are needed).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function commandAvailable(command, args = ["--version"]) {
  try {
    const result = spawnSync(command, args, {
      timeout: 5000,
      stdio: "ignore",
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function isWritableDirectory(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function sqliteStatus() {
  const { dataDir, dbPath } = require("../db/db");
  const dir = dataDir();
  const file = dbPath();
  const status = {
    path: file,
    dataDirWritable: isWritableDirectory(dir),
    fileExists: false,
    tables: null,
    error: null,
  };
  try {
    status.fileExists = fs.existsSync(file);
    if (!status.fileExists) return status;
    // Open read-only: never create/lock the production DB from a health check.
    const Database = require("better-sqlite3");
    const ro = new Database(file, { readonly: true });
    try {
      status.tables = ro
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((r) => r.name);
    } finally {
      ro.close();
    }
  } catch (err) {
    status.error = String((err && err.message) || err).slice(0, 200);
  }
  return status;
}

function toolsStatus() {
  return {
    ytdlpAvailable: commandAvailable("yt-dlp"),
    ffmpegAvailable: commandAvailable("ffmpeg", ["-version"]),
  };
}

function readBackupState(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, ".backup-state.json"), "utf8");
    const state = JSON.parse(raw);
    return {
      lastBackupAt: state.lastBackupAt || null,
      lastCheckedAt: state.lastCheckedAt || null,
      lastCommit: state.lastCommit || null,
      lastError: state.lastError || null,
    };
  } catch {
    return { lastBackupAt: null, lastCheckedAt: null, lastCommit: null, lastError: null };
  }
}

function backupStatus() {
  const { config } = require("../config");
  const { dataDir } = require("../db/db");
  const dir = dataDir();
  return {
    enabled: config.githubBackupEnabled,
    repoConfigured: Boolean(config.githubBackupRepo.trim()),
    branch: config.githubBackupBranch,
    gitAvailable: commandAvailable("git"),
    pagesDirWritable: isWritableDirectory(path.join(dir, "pages")),
    ...readBackupState(dir),
  };
}

module.exports = {
  commandAvailable,
  isWritableDirectory,
  sqliteStatus,
  toolsStatus,
  backupStatus,
};
