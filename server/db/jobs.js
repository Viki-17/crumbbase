// SQLite-backed job queue + processing logs (revamp P1 cutover).
// Same API shape as the old Mongo jobs service, minus buffering footguns:
// better-sqlite3 is synchronous, so every call below either works or throws
// immediately — never hangs.
const { randomUUID } = require("crypto");
const { getDb, nowMs } = require("./db");

const MAX_JOB_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 2000;
const MAX_LOGS_PER_SCOPE = 100;

// Quadratic backoff: 30s, 120s, then final. Mirrors the old policy.
function decideRetry(previousAttempts, now = Date.now()) {
  const attempts = previousAttempts + 1;
  if (attempts >= MAX_JOB_ATTEMPTS) {
    return { attempts, retryAt: null, final: true };
  }
  return { attempts, retryAt: now + attempts * attempts * 30_000, final: false };
}

function mapJob(row) {
  if (!row) return null;
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json || "{}");
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    type: row.type,
    sourceId: row.source_id,
    payload,
    status: row.status,
    attempts: row.attempts,
    nextRunAt: row.next_run_at,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function enqueueJob({ type, sourceId = null, payload = {} }) {
  const db = getDb();
  const now = nowMs();
  const job = {
    id: randomUUID(),
    type,
    source_id: sourceId,
    payload_json: JSON.stringify(payload || {}),
    status: "queued",
    attempts: 0,
    next_run_at: now,
    error: null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO jobs (id, type, source_id, payload_json, status, attempts,
      next_run_at, error, created_at, updated_at)
     VALUES (@id, @type, @source_id, @payload_json, @status, @attempts,
      @next_run_at, @error, @created_at, @updated_at)`,
  ).run(job);
  return mapJob(job);
}

// Compat shim: same call shape as the old queue (publishJob({type, ...})).
function publishJob(message) {
  const { type, sourceId = null, payload = {} } = message;
  return enqueueJob({ type, sourceId, payload });
}

function nextDueJob() {
  const row = getDb()
    .prepare(
      `SELECT * FROM jobs
       WHERE status IN ('queued', 'failed')
         AND next_run_at <= ?
         AND attempts <= ?
       ORDER BY next_run_at ASC, created_at ASC
       LIMIT 1`,
    )
    .get(nowMs(), MAX_JOB_ATTEMPTS);
  return mapJob(row);
}

function markJobRunning(id) {
  getDb().prepare("UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ?").run(nowMs(), id);
}

function markJobComplete(id) {
  getDb()
    .prepare("UPDATE jobs SET status = 'complete', error = NULL, updated_at = ? WHERE id = ?")
    .run(nowMs(), id);
}

function markJobFailed(id, attempts, error, retryAt) {
  getDb()
    .prepare(
      "UPDATE jobs SET status = 'failed', attempts = ?, error = ?, next_run_at = ?, updated_at = ? WHERE id = ?",
    )
    .run(attempts, String(error).slice(0, 2000), retryAt == null ? nowMs() : retryAt, nowMs(), id);
}

function markStaleRunningJobsQueued() {
  getDb().prepare("UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running'").run(nowMs());
}

function getQueueDepth() {
  const db = getDb();
  const count = (status) =>
    db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status = ?").get(status).c;
  return { queued: count("queued"), running: count("running"), failed: count("failed") };
}

function addLog({ sourceId = null, level = "info", message }) {
  const db = getDb();
  const row = {
    id: randomUUID(),
    source_id: sourceId,
    level,
    message: String(message).slice(0, 4000),
    created_at: nowMs(),
  };
  db.prepare(
    "INSERT INTO processing_logs (id, source_id, level, message, created_at) VALUES (@id, @source_id, @level, @message, @created_at)",
  ).run(row);
  return row;
}

function getLogsForSource(sourceId, limit = MAX_LOGS_PER_SCOPE) {
  // IS (not =): callers pass null for global-scope logs, and NULL = NULL is
  // never true in SQL — IS matches nulls correctly.
  return getDb()
    .prepare("SELECT * FROM processing_logs WHERE source_id IS ? ORDER BY created_at DESC LIMIT ?")
    .all(sourceId, limit)
    .reverse();
}

module.exports = {
  MAX_JOB_ATTEMPTS,
  POLL_INTERVAL_MS,
  decideRetry,
  enqueueJob,
  publishJob,
  nextDueJob,
  markJobRunning,
  markJobComplete,
  markJobFailed,
  markStaleRunningJobsQueued,
  getQueueDepth,
  addLog,
  getLogsForSource,
};
