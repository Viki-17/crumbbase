// Sync handler: backup-repo hub as the meeting point between machines.
// Manual `sync` jobs only (POST /api/sync/run). Flow:
//   1. fetch the hub branch (read-only — the working tree is never merged)
//   2. for each hub manifest entry: read pages/<id>.md via `git show`,
//      import when the canonical URL is missing locally or the hub copy is
//      newer (newer-wins; losers are replaced, never duplicated)
//   3. chain a manual backup push so the union goes back to the hub
//
// Identity is the source canonical URL (UUIDs are per-machine). A single bad
// page is logged and skipped — partial progress is safe because every step
// is idempotent (re-running imports the rest, push skips when unchanged).
const { handleBackup, ensureRepo, git } = require("./backup");
const { config } = require("../config");
const { dataDir } = require("../db/db");
const fs = require("fs");
const path = require("path");
const jobs = require("../db/jobs");
const events = require("../services/events");
const importer = require("../services/mirror-import");

function hubRef(branch) {
  return `origin/${branch}`;
}

function isDivergenceError(err) {
  return /non-fast-forward|fetch first|\[rejected\]/.test(String((err && err.message) || err));
}

// Diverged histories on push: safe to auto-merge HERE (and only here)
// because the pull phase already made local content the resolved union —
// hub pages are all imported or deliberately skipped as older. So file
// conflicts resolve local-wins (-X ours), and manifest.json is rewritten as
// the entry union (newer updated_at wins per page id) so neither side's
// pages silently drop out of the manifest.
async function mergeHubHistory(dir, branch, log) {
  const mirror = require("../services/mirror");
  const ref = hubRef(branch);
  await git(dir, ["fetch", "origin", branch]);
  let hubManifest = { pages: [] };
  try {
    hubManifest = JSON.parse(await git(dir, ["show", `${ref}:manifest.json`]));
    if (!hubManifest || !Array.isArray(hubManifest.pages)) hubManifest = { pages: [] };
  } catch {
    hubManifest = { pages: [] };
  }
  await log("info", `Sync: hub history diverged — merging ${hubManifest.pages.length} hub page(s), local wins on conflicts.`);
  await git(dir, [
    "-c", "user.name=crumbbase",
    "-c", "user.email=crumbbase@local",
    "merge", "--allow-unrelated-histories", "-X", "ours", "--no-commit", ref,
  ]);
  const localManifest = mirror.readManifest();
  const byId = new Map();
  for (const p of hubManifest.pages || []) {
    if (p && p.id) byId.set(p.id, { id: p.id, file: p.file, updated_at: Number(p.updated_at) || 0 });
  }
  for (const p of (localManifest.pages || [])) {
    if (!p || !p.id) continue;
    const prev = byId.get(p.id);
    const mine = { id: p.id, file: p.file, updated_at: Number(p.updated_at) || 0 };
    if (!prev || mine.updated_at >= prev.updated_at) byId.set(p.id, mine);
  }
  const merged = {
    version: 1,
    exported_at: Date.now(),
    pages: [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(merged, null, 2)}\n`);
  // index.md is derived, never merged: regenerate from the merged tree so it
  // can't silently miss hub pages that -X ours kept on disk but dropped from
  // a conflicted listing.
  try {
    mirror.writeBundleIndex();
  } catch (err) {
    await log("warn", `Sync: index regen failed (${String((err && err.message) || err).slice(0, 120)})`);
  }
  const addPaths = ["pages", ".gitignore", "manifest.json", "index.md"].concat(
    fs.existsSync(path.join(dir, "assets")) ? ["assets"] : [],
  );
  await git(dir, ["add", "--", ...addPaths]);
  try {
    await git(dir, [
      "-c", "user.name=crumbbase",
      "-c", "user.email=crumbbase@local",
      "commit", "-m", `backup: merge hub history (${merged.pages.length} pages)`,
    ]);
  } catch (err) {
    if (!String((err && err.message) || "").includes("nothing to commit")) throw err;
  }
  await git(dir, ["push", "-u", "origin", `HEAD:${branch}`]);
  const commit = await git(dir, ["rev-parse", "HEAD"]);
  return { pushed: true, commit };
}

async function readHubManifest(dir, branch) {
  try {
    await git(dir, ["rev-parse", "--verify", hubRef(branch)]);
  } catch {
    return { version: 1, exported_at: 0, pages: [] }; // empty/unborn remote
  }
  try {
    const raw = await git(dir, ["show", `${hubRef(branch)}:manifest.json`]);
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.pages)) return { version: 1, exported_at: 0, pages: [] };
    return parsed;
  } catch {
    return { version: 1, exported_at: 0, pages: [] };
  }
}

async function handleSync(job) {
  const log = (level, message) => jobs.addLog({ sourceId: null, level, message });
  const dir = dataDir();

  if (!config.githubBackupEnabled || !config.githubBackupRepo.trim()) {
    throw new Error("Sync needs GITHUB_BACKUP_ENABLED=true and GITHUB_BACKUP_REPO set.");
  }
  const repo = config.githubBackupRepo.trim();
  const branch = config.githubBackupBranch || "main";

  fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
  await ensureRepo(dir, repo, branch);
  try {
    await git(dir, ["fetch", "origin", branch]);
  } catch (err) {
    throw new Error(`Sync fetch failed (hub unreachable, local DB untouched): ${err.message}`);
  }

  const hub = await readHubManifest(dir, branch);
  await log("info", `Sync: hub has ${hub.pages.length} page(s), pulling missing/newer…`);

  const summary = { imported: 0, updated: 0, skipped: 0, failed: [] };
  for (const entry of hub.pages) {
    const file = entry && entry.file;
    if (!file || !/^pages\/[A-Za-z0-9_.-]+\.md$/.test(file)) {
      summary.failed.push({ file: String(file), error: "bad manifest entry" });
      continue;
    }
    let markdown;
    try {
      markdown = await git(dir, ["show", `${hubRef(branch)}:${file}`]);
    } catch (err) {
      await log("warn", `Sync: hub file ${file} unreadable, skipping (${err.message.slice(0, 120)})`);
      summary.failed.push({ file, error: "unreadable" });
      continue;
    }
    try {
      const result = importer.importPageMarkdown(markdown);
      summary[result.action] = (summary[result.action] || 0) + 1;
      if (result.action !== "skipped") {
        await log("info", `Sync: ${result.action} "${file}" (${result.blockCount} blocks).`);
      }
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      await log("warn", `Sync: import of ${file} failed, skipping (${message.slice(0, 200)})`);
      summary.failed.push({ file, error: message.slice(0, 200) });
    }
  }

  // Push the union back to the hub (manual = bypass daily gate, still
  // skips the push entirely when the mirror is unchanged). Diverged history
  // auto-merges (see mergeHubHistory); any other push failure only warns —
  // the pull half is already safely committed to the local DB.
  let pushed = false;
  try {
    const backupResult = await handleBackup({ sourceId: null, payload: { manual: true } });
    pushed = Boolean(backupResult && backupResult.pushed);
  } catch (err) {
    if (isDivergenceError(err)) {
      const merged = await mergeHubHistory(dir, branch, log);
      pushed = merged.pushed;
      await log("info", `Sync: merged hub history and pushed (${String(merged.commit).slice(0, 8)}).`);
    } else {
      const message = err && err.message ? err.message : String(err);
      await log("warn", `Sync: pull complete but push failed (${message.slice(0, 200)})`);
    }
  }

  const done = { ...summary, pushed };
  await log(
    "info",
    `Sync done: ${summary.imported} imported, ${summary.updated} updated, ${summary.skipped} already current, ${summary.failed.length} failed, push ${pushed ? "sent" : "skipped"}.`,
  );
  events.publishEvent({ type: "syncDone", sourceId: null, ...done });
  return done;
}

module.exports = { handleSync };
