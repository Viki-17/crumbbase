// URL normalization for capture (revamp P1).
// Ported from learncache's src/server/lib/url.ts, adapted to our source types.
// Every capture goes through normalizeCaptureUrl so the same video shared as
// youtu.be/xyz, youtube.com/watch?v=xyz&t=30s, or with utm params maps to ONE
// canonical_url — and the UNIQUE constraint there is what makes dedupe airtight.
const AUDIO_EXTENSIONS = new Set([
  "mp3", "m4a", "wav", "webm", "mp4", "mpeg", "mpga", "aac", "ogg", "opus",
]);

// Query params that never identify the content — stripped for canonical form.
const TRACKING_PARAMS = new Set(["feature", "si", "fbclid", "gclid", "igshid", "mc_cid", "mc_eid"]);

function isTrackingParam(key) {
  return /^utm_/i.test(key) || TRACKING_PARAMS.has(key.toLowerCase());
}

function extensionFromPath(pathname) {
  const last = pathname.split("/").pop();
  if (!last || !last.includes(".")) return null;
  return last.split(".").pop().toLowerCase();
}

function classifySource(url) {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (
    host === "youtube.com" ||
    host === "youtu.be" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host.endsWith(".youtube.com")
  ) {
    return "youtube";
  }
  const ext = extensionFromPath(url.pathname);
  if (ext && AUDIO_EXTENSIONS.has(ext)) return "podcast";
  return "unknown";
}

function youtubeVideoId(url, host) {
  if (host === "youtu.be") {
    const seg = url.pathname.split("/").filter(Boolean)[0];
    return seg || null;
  }
  // /watch?v=, /shorts/<id>, /embed/<id>, /live/<id>
  const v = url.searchParams.get("v");
  if (v) return v;
  const m = url.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/);
  return m ? m[2] : null;
}

function canonicalizeYouTubeUrl(url) {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const videoId = youtubeVideoId(url, host);
  if (videoId) {
    const canonical = new URL("https://www.youtube.com/watch");
    canonical.searchParams.set("v", videoId);
    const playlist = url.searchParams.get("list");
    if (playlist) canonical.searchParams.set("list", playlist);
    return canonical.toString();
  }
  return canonicalizeGenericUrl(url);
}

function canonicalizeGenericUrl(url) {
  const canonical = new URL(url.toString());
  canonical.hash = "";
  for (const key of [...canonical.searchParams.keys()]) {
    if (isTrackingParam(key)) canonical.searchParams.delete(key);
  }
  canonical.hostname = canonical.hostname.toLowerCase();
  if (canonical.pathname !== "/" && canonical.pathname.endsWith("/")) {
    canonical.pathname = canonical.pathname.slice(0, -1);
  }
  canonical.searchParams.sort();
  return canonical.toString();
}

// ?t=1h2m3s / ?t=90 / ?start=90 → seconds (for P2 timestamp deep-links).
function parseTimestampSeconds(url) {
  const raw = url.searchParams.get("t") || url.searchParams.get("start");
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (parseInt(m[1] || "0", 10) * 3600) + (parseInt(m[2] || "0", 10) * 60) + parseInt(m[3] || "0", 10);
}

function normalizeCaptureUrl(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) throw new Error("Paste a YouTube, podcast, blog, or book URL.");

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  const sourceType = classifySource(parsed);
  const canonicalUrl =
    sourceType === "youtube" ? canonicalizeYouTubeUrl(parsed) : canonicalizeGenericUrl(parsed);

  return {
    originalUrl: trimmed,
    canonicalUrl,
    sourceType,
    startSeconds: parseTimestampSeconds(parsed),
  };
}

module.exports = {
  normalizeCaptureUrl,
  classifySource,
  canonicalizeYouTubeUrl,
  canonicalizeGenericUrl,
  parseTimestampSeconds,
};
