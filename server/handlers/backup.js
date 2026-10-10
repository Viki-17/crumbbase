// Backup handler: push the ./data mirror to the private GitHub repo (P1).
// Runs on `backup` jobs. Flow:
//   1. disabled or no repo configured → complete immediately (nothing to do)
//   2. debounce: a successful backup < DEBOUNCE_MS ago → complete, log skip
//   3. ensure ./data is a git repo with origin = GITHUB_BACKUP_REPO
//   4. commit mirror files (pages/, assets/, manifest.json) if anything changed
//   5. push HEAD to the configured branch, record state
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

const DEBOUNCE_MS = 5 * 60 * 1000;
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
    return JSON.parse(fs.readFileSync(statePath(dir), "utf8"));
  } catch {
    return { lastBackupAt: 0, lastCommit: null, lastError: null };
  }
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
  if (state.lastBackupAt && Date.now() - state.lastBackupAt < DEBOUNCE_MS) {
    await log("info", "Backup debounced (a successful backup ran < 5 min ago).");
    return { skipped: true, debounced: true };
  }

  const repo = config.githubBackupRepo.trim();
  const branch = config.githubBackupBranch || "main";
  try {
    fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
    await ensureRepo(dir, repo, branch);

    const status = await git(dir, ["status", "--porcelain", "--", "pages", "assets", "manifest.json", ".gitignore"]);
    let commit = state.lastCommit;
    if (status) {
      // git add fails on missing pathspecs (e.g. no assets/ yet) — add what exists.
      const addPaths = ["pages", ".gitignore"]
        .concat(fs.existsSync(path.join(dir, "manifest.json")) ? ["manifest.json"] : [])
        .concat(fs.existsSync(path.join(dir, "assets")) ? ["assets"] : []);
      await git(dir, ["add", "--", ...addPaths]);
      const changed = await git(dir, ["status", "--porcelain"]);
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
    } else {
      await log("info", "Backup: mirror unchanged, nothing to commit.");
    }

    await git(dir, ["push", "-u", "origin", `HEAD:${branch}`]);
    commit = await git(dir, ["rev-parse", "HEAD"]);
    writeState(dir, { lastBackupAt: Date.now(), lastCommit: commit, lastError: null });
    await log("info", `Backup pushed (${commit.slice(0, 8)} → ${branch}).`);
    events.publishEvent({ type: "backupDone", commit, sourceId: job.sourceId || null });
    return { pushed: true, commit };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    writeState(dir, { lastError: message.slice(0, 500) });
    throw new Error(`Backup failed: ${message}`);
  }
}

module.exports = { handleBackup, DEBOUNCE_MS, readState };
