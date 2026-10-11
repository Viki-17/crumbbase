// Backup handler: push the ./data mirror to the private GitHub repo (P1).
// Runs on `backup` jobs. Policy: at most one push per day, and no push at
// all when the mirror is unchanged since the last sync. Flow:
//   1. disabled or no repo configured → complete immediately (nothing to do)
//   2. daily gate: last sync (push or unchanged-check) < BACKUP_INTERVAL_MS
//      ago → complete, log skip. Manual runs bypass this gate.
//   3. ensure ./data is a git repo with origin = GITHUB_BACKUP_REPO
//   4. mirror changed → commit + push, record lastBackupAt
//      mirror unchanged → record lastCheckedAt, skip the push entirely
//
// Never committed: crumbbase.db* and .backup-state.json (see DATA_GITIGNORE,
// written idempotently into ./data/.gitignore). Auth comes from the
// environment (ssh agent / credential helper) — use the SSH remote URL on
// servers: git@github.com:USER/crumbbase-backup.git
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");

const execFileAsync = promisify(execFile);

// Once-a-day backup cadence. Manual `POST /api/backup/run` jobs bypass it.
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DATA_GITIGNORE = `# Crumbbase backup repo: mirror only, never the runtime DB.
*.db
*.db-wal
*.db-shm
*.db-journal
.backup-state.json
`;

function statePath(dir) {
  return path.join(dir, ".backup-state.json");
}

function readState(dir) {
  try {
    return {
      lastBackupAt: 0,
      lastCheckedAt: 0,
      lastCommit: null,
      lastError: null,
      ...JSON.parse(fs.readFileSync(statePath(dir), "utf8")),
    };
  } catch {
    return { lastBackupAt: 0, lastCheckedAt: 0, lastCommit: null, lastError: null };
  }
}

// Last time we synced with the remote for any reason (push or verified
// unchanged). Drives the daily gate; old states without lastCheckedAt fall
// back to lastBackupAt.
function lastSyncAt(state) {
  return Math.max(state.lastBackupAt || 0, state.lastCheckedAt || 0);
}

// True when a sync is due (never synced, or interval elapsed).
function backupDue(dir, now = Date.now()) {
  return now - lastSyncAt(readState(dir)) >= BACKUP_INTERVAL_MS;
}

function writeState(dir, patch) {
  const state = { ...readState(dir), ...patch };
  fs.writeFileSync(statePath(dir), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

async function git(dir, args) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: dir, timeout: 60_000 });
    return stdout.trim();
  } catch (err) {
    const detail = String((err && err.stderr) || (err && err.message) || err).slice(0, 300);
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
}

async function ensureRepo(dir, remoteUrl, branch) {
  if (!fs.existsSync(path.join(dir, ".git"))) {
    await git(dir, ["init", "-b", branch]);
  }
  // .gitignore keeps the DB and backup state out of every commit.
  const ignoreFile = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignoreFile)) fs.writeFileSync(ignoreFile, DATA_GITIGNORE);
  // Local identity so commits never depend on global git config.
  await git(dir, ["config", "user.name", "crumbbase"]);
  await git(dir, ["config", "user.email", "crumbbase@local"]);
  let current = "";
  try {
    current = await git(dir, ["remote", "get-url", "origin"]);
  } catch {
    current = "";
  }
  if (current !== remoteUrl) {
    if (current) await git(dir, ["remote", "remove", "origin"]);
    await git(dir, ["remote", "add", "origin", remoteUrl]);
  }
  await git(dir, ["checkout", "-B", branch]);
}

async function handleBackup(job) {
  const jobs = require("../db/jobs");
  const events = require("../services/events");
  const { config } = require("../config");
  const { dataDir } = require("../db/db");

  const log = (level, message) => jobs.addLog({ sourceId: job.sourceId || null, level, message });
  const dir = dataDir();

  if (!config.githubBackupEnabled || !config.githubBackupRepo.trim()) {
    await log("info", "Backup skipped (GITHUB_BACKUP_ENABLED=false or no repo configured).");
    events.publishEvent({ type: "backupSkipped", sourceId: job.sourceId || null });
    return { skipped: true };
  }

  const state = readState(dir);
  const manual = Boolean(job.payload && job.payload.manual);
  if (!manual && !backupDue(dir)) {
    const nextIn = Math.max(
      0,
      BACKUP_INTERVAL_MS - (Date.now() - lastSyncAt(state)),
    );
    const nextHrs = (nextIn / 3_600_000).toFixed(1);
    await log("info", `Backup skipped (last sync < 24h ago; next check in ~${nextHrs}h).`);
    return { skipped: true, gated: true };
  }

  const repo = config.githubBackupRepo.trim();
  const branch = config.githubBackupBranch || "main";
  try {
    fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
    await ensureRepo(dir, repo, branch);

    const status = await git(dir, ["status", "--porcelain", "--", "pages", "assets", "manifest.json", "index.md", ".gitignore"]);
    if (!status) {
      writeState(dir, { lastCheckedAt: Date.now(), lastError: null });
      await log("info", "Backup: mirror unchanged since last sync — nothing to push.");
      events.publishEvent({ type: "backupSkipped", sourceId: job.sourceId || null });
      return { pushed: false, unchanged: true };
    }

    // git add fails on missing pathspecs (e.g. no assets/ yet) — add what exists.
    const addPaths = ["pages", ".gitignore"]
      .concat(fs.existsSync(path.join(dir, "manifest.json")) ? ["manifest.json"] : [])
      .concat(fs.existsSync(path.join(dir, "index.md")) ? ["index.md"] : [])
      .concat(fs.existsSync(path.join(dir, "assets")) ? ["assets"] : []);
    await git(dir, ["add", "--", ...addPaths]);
    const changed = await git(dir, ["status", "--porcelain"]);
    let commit = state.lastCommit;
    if (changed) {
      const count = await git(dir, ["ls-files", "pages"]).then(
        (out) => out.split("\n").filter(Boolean).length,
        () => 0,
      );
      await git(dir, [
        "-c", "user.name=crumbbase",
        "-c", "user.email=crumbbase@local",
        "commit", "-m", `backup: ${new Date().toISOString()} (${count} pages)`,
      ]);
    }

    await git(dir, ["push", "-u", "origin", `HEAD:${branch}`]);
    commit = await git(dir, ["rev-parse", "HEAD"]);
    writeState(dir, { lastBackupAt: Date.now(), lastCheckedAt: Date.now(), lastCommit: commit, lastError: null });
    await log("info", `Backup pushed (${commit.slice(0, 8)} → ${branch}).`);
    events.publishEvent({ type: "backupDone", commit, sourceId: job.sourceId || null });
    return { pushed: true, commit };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    writeState(dir, { lastError: message.slice(0, 500) });
    // Diverged histories (fresh machine, hub ahead) are not corruption — but
    // a blind push would clobber the hub, so fail loudly and point at sync,
    // which merges content-first and is safe to retry.
    const hint = /non-fast-forward|fetch first|\[rejected\]/.test(message)
      ? " (hub has history this machine lacks — run POST /api/sync/run to merge, then retry)"
      : "";
    throw new Error(`Backup failed${hint}: ${message}`);
  }
}

module.exports = { handleBackup, BACKUP_INTERVAL_MS, backupDue, lastSyncAt, readState, ensureRepo, git };
