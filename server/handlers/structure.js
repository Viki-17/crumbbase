// Structure handler: transcript → page + blocks + tags + FTS + mirror (P1).
// Runs on `structure` jobs (enqueued by ingest and paste flows).
// LLM: OpenCode `pro` via generateJSON, validated by zod, clamped to budgets.
// Retry-safe: the page is fully replaced on every run, so a retried job never
// duplicates blocks. On the final attempt the source is marked failed.
const { z } = require("zod");
const opencode = require("../services/opencode-client");
const sourcesRepo = require("../db/sources");
const pagesRepo = require("../db/pages");
const jobs = require("../db/jobs");
const events = require("../services/events");
const mirror = require("../services/mirror");

const MODEL = opencode.modelLabel("pro");
const TRANSCRIPT_BUDGET = 15000;
const CHUNK_EVERY_SEGMENTS = 5;
const MAX_IDEAS = 12;
const MAX_CLAIMS = 10;
const MAX_QUESTIONS = 8;
const MAX_TAGS = 12;
const MAX_ALIASES = 5;
const MAX_ENTITIES = 12;
const MAX_ENTITY_ALIASES = 3;

const notesSchema = z.object({
  tldr: z.string().min(1),
  keyIdeas: z
    .array(
      z.object({
        label: z.string().min(1),
        summary: z.string().min(1),
        timestamp: z.number().nullable().default(null),
        aliases: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  notableClaims: z
    .array(
      z.object({
        claim: z.string().min(1),
        support: z.string().min(1),
        timestamp: z.number().nullable().default(null),
        aliases: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  followUpQuestions: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  entities: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        aliases: z.array(z.string()).default([]),
        evidence: z.string().default(""),
      }),
    )
    .default([]),
});

function truncateTranscript(text) {
  const t = String(text || "");
  if (t.length <= TRANSCRIPT_BUDGET) return t;
  const head = Math.ceil((TRANSCRIPT_BUDGET * 4) / 5);
  return `${t.slice(0, head)}\n\n[... middle trimmed for length ...]\n\n${t.slice(-(TRANSCRIPT_BUDGET - head))}`;
}

function buildPrompt({ title, creator, url, durationSeconds, transcript }) {
  return [
    "You turn a video/podcast transcript into structured learning notes.",
    "Return JSON ONLY (no markdown fences, no commentary) with EXACTLY this shape:",
    "{",
    '  "tldr": "2-3 sentence gist",',
    '  "keyIdeas": [{"label": "short name", "summary": "1-2 sentences", "timestamp": seconds|null, "aliases": ["alternate phrasing", "..."]}],',
    '  "notableClaims": [{"claim": "...", "support": "...", "timestamp": seconds|null, "aliases": ["alternate phrasing"]}],',
    '  "followUpQuestions": ["..."],',
    '  "tags": ["kebab-case-topic", "..."],',
    '  "entities": [{"name": "Palantir", "aliases": ["palantir technologies"], "evidence": "verbatim sentence from the notes where it appears"}]',
    "}",
    "Rules:",
    "- timestamps are seconds into the media (or null when unsure)" +
      (durationSeconds != null ? `; media length is ${durationSeconds}s, never exceed it` : ""),
    "- 4-8 key ideas, each with 2-4 search aliases (how a user might rephrase it)",
    "- claim aliases (1-2 each): alternate phrasings of the claim",
    "- idea AND claim aliases must name the originating entity where one exists (e.g. a Palantir-originated practice gets alias 'palantir'; a TCS layoff claim gets alias 'tcs')",
    "- entities are 5-12 proper nouns / named practices / movements central to the notes (companies, people, frameworks, named roles like 'forward deployed engineer'), each with 1-3 aliases (acronyms, alternate casings) and the verbatim evidence sentence from the notes",
    "- claims need their supporting evidence quoted or paraphrased",
    "- tags are kebab-case topics, max 12",
    `Title: ${title || "Untitled"}`,
    creator ? `Creator: ${creator}` : null,
    `URL: ${url}`,
    "",
    "TRANSCRIPT:",
    truncateTranscript(transcript),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function sanitizeTimestamp(value, durationSeconds) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (durationSeconds != null && n > durationSeconds) return durationSeconds;
  return Math.floor(n);
}

function chunkSegments(segments, every = CHUNK_EVERY_SEGMENTS) {
  const chunks = [];
  for (let i = 0; i < segments.length; i += every) {
    const group = segments.slice(i, i + every);
    chunks.push({
      text: group.map((s) => s.text).join(" "),
      start: group[0].start,
      segmentRange: [i, i + group.length - 1],
    });
  }
  return chunks;
}

async function handleStructure(job) {
  const source = sourcesRepo.getSource(job.sourceId);
  if (!source) {
    await jobs.addLog({ sourceId: job.sourceId, level: "warn", message: "Structure: source deleted, skipping." });
    return;
  }
  if (source.status === "complete") return; // idempotent re-run

  const transcript = sourcesRepo.getTranscript(source.id);
  if (!transcript || !transcript.text.trim()) {
    throw new Error("No transcript is saved for this source yet.");
  }

  const log = (level, message) => jobs.addLog({ sourceId: source.id, level, message });
  await log("info", `Generating learning notes with ${MODEL}.`);

  let notes;
  try {
    const raw = await opencode.generateJSON(
      buildPrompt({
        title: source.title,
        creator: source.creator,
        url: source.canonicalUrl,
        durationSeconds: source.durationSeconds,
        transcript: transcript.text,
      }),
      "pro",
    );
    if (!raw) throw new Error("AI returned no parseable JSON.");
    notes = notesSchema.parse(raw);
  } catch (err) {
    if (err && err.name === "ZodError") {
      const first = err.issues && err.issues[0];
      throw new Error(
        `AI notes failed validation: ${first ? `${first.path.join(".")}: ${first.message}` : "unknown"}`,
      );
    }
    throw err;
  }

  const tags = [...new Set(notes.tags.map((t) => pagesRepo.normalizeTag(t)).filter(Boolean))].slice(0, MAX_TAGS);
  // Tags live in the tags table + mirror ## Tags section only — never baked
  // into block content (Stage 0 polish: inline tag spam killed readability).
  const hasRealTimestamps = transcript.origin === "caption"; // paste flow has none
  const ts = (v) => (hasRealTimestamps ? sanitizeTimestamp(v, source.durationSeconds) : null);

  // Full replace — retries never duplicate.
  const page = pagesRepo.replacePageForSource(source.id, source.title || "Untitled Video");
  let position = 0;
  const next = () => position++;

  const tldrBlock = pagesRepo.addBlock({
    pageId: page.id,
    position: next(),
    content: notes.tldr,
    props: { kind: "tldr" },
  });
  for (const tag of tags) pagesRepo.addTag(tldrBlock.id, tag);
  pagesRepo.indexBlock({ blockId: tldrBlock.id, title: page.title, content: notes.tldr, aliases: [], tags });

  for (const idea of notes.keyIdeas.slice(0, MAX_IDEAS)) {
    const aliases = [...new Set((idea.aliases || []).map((a) => String(a).trim()).filter(Boolean))].slice(0, MAX_ALIASES);
    const block = pagesRepo.addBlock({
      pageId: page.id,
      position: next(),
      content: `**${idea.label}:** ${idea.summary}`,
      props: { kind: "key-idea", timestamp: ts(idea.timestamp), aliases },
    });
    for (const tag of tags) pagesRepo.addTag(block.id, tag);
    pagesRepo.indexBlock({ blockId: block.id, title: page.title, content: `${idea.label} ${idea.summary}`, aliases, tags });
  }

  for (const claim of notes.notableClaims.slice(0, MAX_CLAIMS)) {
    const aliases = [...new Set((claim.aliases || []).map((a) => String(a).trim()).filter(Boolean))].slice(0, MAX_ALIASES);
    const block = pagesRepo.addBlock({
      pageId: page.id,
      position: next(),
      content: `${claim.claim} (${claim.support})`,
      props: { kind: "claim", timestamp: ts(claim.timestamp), aliases },
    });
    pagesRepo.indexBlock({ blockId: block.id, title: page.title, content: `${claim.claim} ${claim.support}`, aliases, tags });
  }

  for (const question of notes.followUpQuestions.slice(0, MAX_QUESTIONS)) {
    const block = pagesRepo.addBlock({
      pageId: page.id,
      position: next(),
      content: question,
      props: { kind: "question" },
    });
    pagesRepo.indexBlock({ blockId: block.id, title: page.title, content: question, aliases: [], tags });
  }

  for (const chunk of chunkSegments(transcript.segments)) {
    const block = pagesRepo.addBlock({
      pageId: page.id,
      position: next(),
      content: chunk.text,
      props: { kind: "transcript-chunk", timestamp: hasRealTimestamps ? sanitizeTimestamp(chunk.start, source.durationSeconds) : null, segmentRange: chunk.segmentRange },
    });
    pagesRepo.indexBlock({ blockId: block.id, title: page.title, content: chunk.text, aliases: [] });
  }

  const entities = [...(notes.entities || [])]
    .map((e) => ({
      name: String((e && e.name) || "").trim().slice(0, 60),
      aliases: [...new Set(((e && e.aliases) || []).map((a) => String(a).trim()).filter(Boolean))].slice(0, MAX_ENTITY_ALIASES),
      evidence: String((e && e.evidence) || "").trim().slice(0, 200),
    }))
    .filter((e) => e.name.length >= 2)
    .slice(0, MAX_ENTITIES);

  const blockCount = pagesRepo.countBlocks(page.id);

  // Concepts ride the same pro call (no extra AI latency): entities become
  // concept rows, blocks mentioning them get edges + reindexed FTS.
  let conceptCount = 0;
  try {
    const concepts = require("../db/concepts");
    conceptCount = concepts.linkEntitiesForPage({ pageId: page.id, entities, tags });
  } catch (err) {
    await log("warn", `Concept linking skipped: ${err && err.message ? err.message : err}`);
  }
  if (entities.length === 0) {
    // Safety net: notes predating entity extraction (or an empty yield) get
    // a flash backfill instead of staying forever unlinkable.
    jobs.enqueueJob({ type: "link_index", sourceId: source.id, payload: {} });
  }

  const { file } = mirror.writePageMirror(page.id, { model: MODEL });

  sourcesRepo.updateSource(source.id, { status: "complete", error: null });
  await log("info", `Learning notes complete (${blockCount} blocks, ${conceptCount} concept links, mirror: ${file}).`);
  events.publishEvent({ type: "sourceStatus", sourceId: source.id, status: "complete" });
  // Mirror changed → queue a (daily-gated) backup push.
  jobs.enqueueJob({ type: "backup", sourceId: source.id, payload: {} });
  // E3 sweep cadence: every 3rd completed capture refreshes cross-source
  // promotion + merge suggestions (cheap: candidates-only single flash call).
  try {
    const { getDb } = require("../db/db");
    const done = getDb().prepare("SELECT COUNT(*) AS c FROM sources WHERE status = 'complete'").get().c;
    if (done > 0 && done % 3 === 0) {
      jobs.enqueueJob({ type: "link_index", sourceId: null, payload: { sweep: true } });
      await log("info", "Queued concept sweep (every-3rd-capture cadence).");
    }
  } catch {
    // sweep scheduling must never fail structuring
  }
  return { pageId: page.id, blockCount };
}

async function runWithFinalFailure(job, fn) {
  try {
    return await fn();
  } catch (err) {
    const attempts = job.attempts || 0;
    if (attempts >= jobs.MAX_JOB_ATTEMPTS - 1) {
      const message = err && err.message ? err.message : String(err);
      sourcesRepo.updateSource(job.sourceId, { status: "failed", error: message.slice(0, 500) });
      await jobs.addLog({ sourceId: job.sourceId, level: "error", message: `Structuring failed finally: ${message}` });
    }
    throw err;
  }
}

module.exports = {
  handleStructure: (job) => runWithFinalFailure(job, () => handleStructure(job)),
  notesSchema,
  buildPrompt,
  truncateTranscript,
  chunkSegments,
  MODEL,
};
