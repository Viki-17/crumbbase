// Ingest handler: YouTube URL → metadata + transcript (revamp P1).
// Chain: yt-dlp captions first; on any fetch failure TRANSCRIPT_PROVIDER
// decides: "auto" → awaiting_paste (first-class designed state, UI shows a
// paste box), "yt-dlp" → throw (queue backoff retries, then failed),
// "paste" → skip fetching entirely. Non-YouTube sources go straight to paste
// (blog/book extractors land in P3; pasted text works for anything).
//
// Idempotent: re-running on a complete source is a no-op; re-running on a
// failed/awaiting source retries the fetch.
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function formatTimestamp(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "";
  const total = Math.max(0, Math.floor(Number(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// "00:01:02.345" or "01:02.345" → seconds (float).
function parseVttTimestamp(ts) {
  const m = ts.trim().match(/^(?:(\d+):)?([0-5]?\d):([0-5]\d)[.,](\d{1,3})$/);
  if (!m) return null;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2], 10);
  const sec = parseInt(m[3], 10);
  const ms = parseInt((m[4] + "00").slice(0, 3), 10);
  return h * 3600 + min * 60 + sec + ms / 1000;
}

function stripCueTags(text) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Minimal VTT → { text, segments: [{start, end, text}] }.
// Skips header/NOTE/STYLE, strips styling tags, collapses consecutive
// duplicate lines (auto-caption rolling window) and duplicate segments.
function parseVtt(body) {
  const lines = String(body || "").split(/\r?\n/);
  const segments = [];
  let i = 0;
  // Skip header (WEBVTT + optional header text) up to first cue/NOTE.
  while (i < lines.length && !lines[i].includes("-->") && !lines[i].startsWith("NOTE")) i += 1;

  let lastText = null;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("NOTE") || line.startsWith("STYLE")) {
      // Skip block until blank line.
      while (i < lines.length && lines[i].trim() !== "") i += 1;
      i += 1;
      continue;
    }
    const arrow = line.indexOf("-->");
    if (arrow === -1) {
      i += 1;
      continue;
    }
    const start = parseVttTimestamp(line.slice(0, arrow));
    const end = parseVttTimestamp(line.slice(arrow + 3));
    i += 1;
    const payload = [];
    while (i < lines.length && lines[i].trim() !== "") {
      const clean = stripCueTags(lines[i]);
      // Collapse rolling-window repeats inside one cue.
      if (clean && clean !== payload[payload.length - 1]) payload.push(clean);
      i += 1;
    }
    i += 1; // consume blank separator
    if (start == null || end == null || payload.length === 0) continue;
    const text = payload.join(" ");
    // Collapse identical back-to-back cues (auto-caption overlap).
    if (text === lastText) continue;
    lastText = text;
    segments.push({ start, end, text });
  }
  return { text: segments.map((s) => s.text).join(" "), segments };
}

const COOKIES_FILENAME = "youtube-cookies.txt";
const MAX_COOKIES_BYTES = 512 * 1024;

// Absolute path of the UI-managed cookies file (<DATA_DIR>/youtube-cookies.txt).
function uiCookiesPath() {
  const path = require("path");
  const { dataDir } = require("../db/db");
  return path.join(dataDir(), COOKIES_FILENAME);
}

// Metadata about the cookies file for status displays. NEVER returns contents.
function cookiesFileStatus() {
  const fs = require("fs");
  try {
    const p = uiCookiesPath();
    const st = fs.statSync(p);
    if (!st.isFile()) return { fileExists: false, updatedAt: null };
    return { fileExists: true, updatedAt: st.mtimeMs };
  } catch {
    return { fileExists: false, updatedAt: null };
  }
}

async function runYtDlpJson(url) {
  const fs = require("fs");
  const path = require("path");
  let stdout;
  // Authenticated fetch: --cookies beats YouTube's bot challenge on
  // datacenter IPs. Precedence: UI-managed <DATA_DIR>/youtube-cookies.txt,
  // then YTDLP_COOKIES from .env. A missing file is ignored so a stale path
  // can never break unauthenticated fetch.
  const args = ["--dump-single-json", "--no-playlist", "--no-warnings"];
  try {
    const candidates = [uiCookiesPath()];
    try {
      const { config } = require("../config");
      const envCookies = String(config.ytdlpCookies || "").trim();
      if (envCookies) candidates.push(path.resolve(process.cwd(), envCookies));
    } catch {
      // config must never break the fetch; fall through to file check
    }
    const found = candidates.find((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (found) args.push("--cookies", found);
    else if (candidates.length > 1)
      console.warn("[ingest] cookies file missing; fetching without cookies.");
  } catch {
    // cookie resolution must never break the fetch; proceed unauthenticated
  }
  args.push(url);
  try {
    ({ stdout } = await execFileAsync("yt-dlp", args, {
      timeout: 90_000,
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (err) {
    if (err && (err.code === "ENOENT" || /not found/i.test(String(err.message)))) {
      throw new Error("yt-dlp is not installed. Install it or paste the transcript manually.");
    }
    const stderr = String((err && err.stderr) || (err && err.message) || err).slice(0, 300);
    throw new Error(`yt-dlp fetch failed: ${stderr}`);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("yt-dlp returned unreadable metadata.");
  }
}

// Pick a downloadable caption track: manual English VTT first, then auto
// English VTT, then any VTT track. Non-VTT (srv3/ttml) is out of P1 scope.
function pickCaptionTrack(info) {
  const groups = [info.subtitles || {}, info.automatic_captions || {}];
  const langsOf = (obj) => Object.keys(obj);
  const englishKeys = (obj) =>
    langsOf(obj).filter((l) => l === "en" || l.toLowerCase().startsWith("en-") || l.toLowerCase().startsWith("en."));
  const vttTrack = (obj, lang) => (obj[lang] || []).find((t) => t.ext === "vtt" && t.url);

  for (const obj of groups) {
    for (const lang of englishKeys(obj)) {
      const track = vttTrack(obj, lang);
      if (track) return { lang, url: track.url, automatic: obj === groups[1] };
    }
  }
  for (const obj of groups) {
    for (const lang of langsOf(obj)) {
      const track = vttTrack(obj, lang);
      if (track) return { lang, url: track.url, automatic: obj === groups[1] };
    }
  }
  return null;
}

async function downloadText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`caption download HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function handleIngest(job) {
  const sources = require("../db/sources");
  const jobs = require("../db/jobs");
  const events = require("../services/events");

  const source = sources.getSource(job.sourceId);
  if (!source) {
    await jobs.addLog({ sourceId: job.sourceId, level: "warn", message: "Ingest: source deleted, skipping." });
    return;
  }
  if (source.status === "complete") return; // idempotent re-run

  const log = (level, message) => jobs.addLog({ sourceId: source.id, level, message });
  const setStatus = (status, patch = {}) => {
    sources.updateSource(source.id, { status, error: null, ...patch });
    events.publishEvent({ type: "sourceStatus", sourceId: source.id, status });
  };

  // Paste-only mode, or non-YouTube (extractors land in P3): wait for paste.
  // Provider is DB-overridable at runtime via the Settings page (no restart).
  const { effectiveTranscriptProvider } = require("../db/settings");
  const provider = effectiveTranscriptProvider();
  if (provider === "paste" || source.sourceType !== "youtube") {
    setStatus("awaiting_paste");
    await log("info", `Waiting for pasted transcript (provider: ${provider}, type: ${source.sourceType}).`);
    return;
  }

  setStatus("fetching");
  await log("info", "Fetching metadata + captions via yt-dlp.");

  try {
    const info = await runYtDlpJson(source.url);
    sources.updateSource(source.id, {
      title: info.title || source.title,
      creator: info.uploader || info.channel || source.creator,
      duration_seconds: Number.isFinite(info.duration) ? Math.round(info.duration) : source.duration_seconds,
      thumbnail_url: info.thumbnail || source.thumbnail_url,
    });

    const track = pickCaptionTrack(info);
    if (!track) {
      const langs = [
        ...Object.keys(info.subtitles || {}),
        ...Object.keys(info.automatic_captions || {}),
      ];
      throw new Error(
        langs.length === 0
          ? "No captions exist for this video."
          : `No downloadable VTT captions (available: ${langs.slice(0, 8).join(", ")}).`,
      );
    }
    await log("info", `Using ${track.automatic ? "auto-generated" : "manual"} captions (${track.lang}).`);

    const vtt = await downloadText(track.url);
    const { text, segments } = parseVtt(vtt);
    if (!text.trim() || segments.length === 0) {
      throw new Error("Caption track downloaded but contained no usable text.");
    }
    sources.upsertTranscript({ sourceId: source.id, text, segments, origin: "caption" });

    setStatus("processing");
    await log("info", `Transcript saved (${segments.length} segments). Queued for structuring.`);
    jobs.enqueueJob({ type: "structure", sourceId: source.id, payload: {} });
  } catch (err) {
    let message = err && err.message ? err.message : String(err);
    // YouTube's bot challenge fails without deno even when cookies are valid —
    // say so in the log instead of leaving the cryptic yt-dlp text bare.
    if (/needs to be reloaded/i.test(message)) {
      message += " (YouTube bot-challenge: install deno so yt-dlp can solve it, and check cookies are fresh.)";
    }
    if (provider === "yt-dlp") throw err; // queue backoff retries
    setStatus("awaiting_paste");
    await log("warn", `Auto-fetch failed (${message}). Paste the transcript to continue.`);
  }
}

module.exports = {
  handleIngest,
  parseVtt,
  pickCaptionTrack,
  formatTimestamp,
  parseVttTimestamp,
  runYtDlpJson,
  uiCookiesPath,
  cookiesFileStatus,
  COOKIES_FILENAME,
  MAX_COOKIES_BYTES,
};
