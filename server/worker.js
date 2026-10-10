// Worker: SQLite job poll loop (revamp P1 cutover).
// Polls the jobs table every 2s and dispatches by type. Handlers land with
// each P1 feature (ingest/structure first); until then the table stays empty.
// Unknown types are logged and marked complete so nothing piles up poisonously.
//
// No framework, no broker, no buffering: better-sqlite3 throws immediately on
// DB errors, and the tick catches per-job so one bad job never stops the loop.
const jobsQueue = require("./db/jobs");
const events = require("./services/events");

// P1 registers handlers here; ingest is first. Each handler is
// handleX(job) and may throw (queue retries) or set awaiting_* states.
const DISPATCH = {
  ingest: require("./handlers/ingest").handleIngest,
  structure: require("./handlers/structure").handleStructure,
  backup: require("./handlers/backup").handleBackup,
  link_index: require("./handlers/concepts").handleLinkIndex,
};

async function processJob(job) {
  const handler = DISPATCH[job.type];
  if (!handler) {
    await jobsQueue.addLog({
      sourceId: job.sourceId,
      level: "warn",
      message: `No handler for job type "${job.type}" yet (revamp P1). Marked complete.`,
    });
    return;
  }
  await handler(job);
}

let running = false;
let timer = null;
let backupTimer = null;

// Once-a-day backup cadence, self-scheduled: every hour (and once at boot)
// check whether a sync is due and, if so, queue one `backup` job. The job
// itself re-checks the daily gate and skips the push when the mirror is
// unchanged — so this can never cause more than one push per day.
function maybeScheduleBackup() {
  try {
    const { config } = require("./config");
    if (!config.githubBackupEnabled || !config.githubBackupRepo.trim()) return;
    const { dataDir } = require("./db/db");
    const backup = require("./handlers/backup");
    if (!backup.backupDue(dataDir())) return;
    if (jobsQueue.hasPendingJob("backup")) return;
    jobsQueue.enqueueJob({ type: "backup", sourceId: null, payload: { scheduled: true } });
  } catch (err) {
    console.error("[Worker] backup schedule check failed:", err && err.message ? err.message : err);
  }
}

async function runWorkerTick() {
  if (running) return;
  running = true;
  try {
    const job = jobsQueue.nextDueJob();
    if (!job) return;

    jobsQueue.markJobRunning(job.id);
    events.publishEvent({ type: "jobStarted", jobId: job.id, jobType: job.type, sourceId: job.sourceId });
    try {
      await processJob(job);
      jobsQueue.markJobComplete(job.id);
      events.publishEvent({ type: "jobDone", jobId: job.id, jobType: job.type, sourceId: job.sourceId });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const retry = jobsQueue.decideRetry(job.attempts || 0, Date.now());
      jobsQueue.markJobFailed(job.id, retry.attempts, message, retry.retryAt);
      try {
        // addLog is synchronous (better-sqlite3) — no .catch(); guard instead
        // so a logging failure can never break the tick.
        jobsQueue.addLog({
          sourceId: job.sourceId,
          level: retry.final ? "error" : "warn",
          message: retry.final
            ? `Job ${job.type} failed: ${message}`
            : `Job ${job.type} failed, retry queued: ${message}`,
        });
      } catch {
        // logging must never break the tick
      }
      events.publishEvent({
        type: "jobFailed",
        jobId: job.id,
        jobType: job.type,
        sourceId: job.sourceId,
        message,
        final: retry.final,
      });
    }
  } catch (err) {
    // Poll-loop itself failed (e.g. DB locked) — log and continue next tick.
    console.error("[Worker] tick error:", err && err.message ? err.message : err);
  } finally {
    running = false;
  }
}

function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = null;
}

async function startWorker() {
  // Opening the DB runs pending migrations; stale running jobs become runnable.
  jobsQueue.markStaleRunningJobsQueued();
  timer = setInterval(() => {
    void runWorkerTick();
  }, jobsQueue.POLL_INTERVAL_MS);
  void runWorkerTick();
  // Daily backup check: hourly cadence + one check at boot.
  backupTimer = setInterval(maybeScheduleBackup, 60 * 60 * 1000);
  maybeScheduleBackup();
  console.log("[Worker] Service Started (SQLite queue)");
}

if (require.main === module) {
  startWorker().catch((err) => {
    console.error("[Worker] failed to start:", err);
    process.exit(1);
  });
}

module.exports = { startWorker, stopWorker, runWorkerTick, processJob, DISPATCH };
