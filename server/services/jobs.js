// DB-backed job queue — ported from learncache's jobs table pattern.
// Replaces RabbitMQ ai.jobs.v2 with a Mongo collection polled every 2s.
//
// Job lifecycle: queued -> running -> complete
//                              \-> failed (retryAt set, up to MAX_JOB_ATTEMPTS)
// Boot calls markStaleRunningJobsQueued() so crashed workers don't wedge jobs.
const { v4: uuidv4 } = require("uuid");
const { Job, ProcessingLog } = require("../models");

const MAX_JOB_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 2000;
const MAX_LOGS_PER_SCOPE = 100;

// Ensure Mongo is connected (storage owns the connection; buffered ops would
// hang if we never connect, so await it explicitly before queue writes).
async function ensureDb() {
  try {
    const { connectDB } = require("./storage");
    await connectDB();
  } catch {
    // storage.connectDB throws when MONGODB_URI is missing — let the
    // caller's error surface instead of masking it here.
  }
}

// --- Retry policy (mirrors learncache/src/server/lib/jobs.ts) ---
function decideRetry(previousAttempts, now = Date.now()) {
  const attempts = previousAttempts + 1;
  if (attempts >= MAX_JOB_ATTEMPTS) {
    return { attempts, retryAt: null, final: true };
  }
  const backoffMs = attempts * attempts * 30_000; // 30s, 120s
  return { attempts, retryAt: new Date(now + backoffMs), final: false };
}

// --- Enqueue ---
async function enqueueJob({ type, bookId = null, chapterId = null, stage = null, payload = {} }) {
  await ensureDb();
  const now = new Date();
  const job = {
    id: uuidv4(),
    type,
    bookId,
    chapterId,
    stage,
    payload,
    status: "queued",
    attempts: 0,
    nextRunAt: now,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await Job.create(job);
  return job;
}

// Back-compat shim: same shape as rabbitmq.publishJob({type, bookId, chapterId, stage, payload})
async function publishJob(message) {
  const { type, bookId = null, chapterId = null, stage = null, payload = {}, ...rest } = message;
  // folder_organize historically passes bookId:"global" — normalize to null
  return enqueueJob({
    type,
    bookId: bookId === "global" ? null : bookId,
    chapterId,
    stage,
    payload: { ...payload, ...rest },
  });
}

// --- Poll ---
async function nextDueJob() {
  const now = new Date();
  return await Job.findOne({
    status: { $in: ["queued", "failed"] },
    nextRunAt: { $lte: now },
    attempts: { $lte: MAX_JOB_ATTEMPTS },
  })
    .sort({ nextRunAt: 1, createdAt: 1 })
    .lean();
}

async function markJobRunning(id) {
  await Job.updateOne({ id }, { status: "running", updatedAt: new Date() });
}

async function markJobComplete(id) {
  await Job.updateOne({ id }, { status: "complete", error: null, updatedAt: new Date() });
}

async function markJobFailed(id, attempts, error, retryAt) {
  await Job.updateOne(
    { id },
    { status: "failed", attempts, error, nextRunAt: retryAt || new Date(), updatedAt: new Date() },
  );
}

async function markStaleRunningJobsQueued() {
  await Job.updateMany({ status: "running" }, { status: "queued", updatedAt: new Date() });
}

async function getQueueDepth() {
  const [queued, running, failed] = await Promise.all([
    Job.countDocuments({ status: "queued" }),
    Job.countDocuments({ status: "running" }),
    Job.countDocuments({ status: "failed" }),
  ]);
  return { queued, running, failed };
}

// --- Processing logs (mirrors learncache's processing_logs, scoped to book/chapter) ---
async function addLog({ bookId = null, chapterId = null, level = "info", message }) {
  await ProcessingLog.create({
    id: uuidv4(),
    bookId,
    chapterId,
    level,
    message,
    createdAt: new Date(),
  });
}

async function getLogsForBook(bookId, limit = MAX_LOGS_PER_SCOPE) {
  return await ProcessingLog.find({ bookId }).sort({ createdAt: -1 }).limit(limit).lean();
}

async function getLogsForChapter(chapterId, limit = MAX_LOGS_PER_SCOPE) {
  return await ProcessingLog.find({ chapterId }).sort({ createdAt: -1 }).limit(limit).lean();
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
  getLogsForBook,
  getLogsForChapter,
};
