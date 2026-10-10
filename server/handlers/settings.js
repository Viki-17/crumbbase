// Settings API backing the P2 Settings page (token-gated).
// Security contract:
// - Every endpoint here requires a valid x-settings-token (fail closed when
//   SETTINGS_TOKEN is empty). Comparison is timing-safe.
// - Cookie file CONTENTS are write-only: no endpoint returns them, nothing
//   logs them. Status surfaces only { fileExists, updatedAt }.
// - The cookies file is written with 0600 under DATA_DIR (gitignored).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function settingsTokenConfigured() {
  const { config } = require("../config");
  return String(config.settingsToken || "");
}

function requireSettingsToken(req, res, next) {
  const expected = settingsTokenConfigured();
  if (!expected) {
    return res.status(403).json({
      error: "Settings API disabled: SETTINGS_TOKEN is not configured on the server.",
    });
  }
  const got = String(req.header("x-settings-token") || "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: "Invalid settings token." });
  }
  next();
}

function settingsStatus() {
  const setupChecks = require("../services/setup-checks");
  const { effectiveTranscriptProvider, getSetting } = require("../db/settings");
  const ingest = require("./ingest");
  const tools = setupChecks.toolsStatus();
  const override = getSetting("transcript_provider", null);
  return {
    transcriptProvider: effectiveTranscriptProvider(),
    transcriptProviderSource: override ? "settings" : "env",
    cookies: ingest.cookiesFileStatus(),
    tools,
    backup: setupChecks.backupStatus(),
  };
}

function validateCookiesText(text) {
  const raw = String(text || "");
  if (!raw.trim()) return { ok: false, error: "Cookies file is empty." };
  if (Buffer.byteLength(raw, "utf8") > 512 * 1024)
    return { ok: false, error: "Cookies file too large (max 512KB)." };
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const looksNetscape = lines.some((l) => l.split("\t").length >= 6);
  if (!looksNetscape)
    return { ok: false, error: "Not a Netscape cookies file (expect tab-separated rows)." };
  if (!/youtube\.com/i.test(raw))
    return { ok: false, error: "No youtube.com cookies found — export with youtube.com included." };
  return { ok: true, value: raw.endsWith("\n") ? raw : raw + "\n" };
}

function saveCookiesFile(text) {
  const ingest = require("./ingest");
  const checked = validateCookiesText(text);
  if (!checked.ok) return checked;
  const p = ingest.uiCookiesPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, checked.value, { mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // non-fatal on filesystems without unix perms
  }
  return { ok: true, ...ingest.cookiesFileStatus() };
}

function clearCookiesFile() {
  const ingest = require("./ingest");
  try {
    fs.unlinkSync(ingest.uiCookiesPath());
  } catch {
    // already gone — still success
  }
  return { ok: true, ...ingest.cookiesFileStatus() };
}

async function testCookiesFetch(url) {
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) return { ok: false, error: "Provide an http(s) video URL to test." };
  const ingest = require("./ingest");
  try {
    const info = await ingest.runYtDlpJson(target);
    return { ok: true, title: info.title || null, duration: info.duration ?? null };
  } catch (err) {
    // yt-dlp errors never contain cookie contents — safe to surface truncated.
    const message = String((err && err.message) || err).slice(0, 300);
    return { ok: false, error: message };
  }
}

module.exports = {
  requireSettingsToken,
  settingsStatus,
  saveCookiesFile,
  clearCookiesFile,
  testCookiesFetch,
};
