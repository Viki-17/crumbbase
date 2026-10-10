// DB-backed runtime settings (P2 settings page).
// Unlike .env (parsed once at boot), rows here are read live per job so the
// Settings UI applies without a restart. .env stays the fallback: a row wins
// when present, otherwise the zod config value is used.
// Secrets policy: cookie FILE CONTENTS are never stored here (0600 file under
// DATA_DIR) and no getter ever returns them — only exists/updatedAt metadata.
const { getDb, nowMs } = require("./db");

const KEYS = new Set(["transcript_provider"]);

function getSetting(key, fallback = null) {
  if (!KEYS.has(key)) return fallback;
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  if (!KEYS.has(key)) throw new Error(`Unknown setting: ${key}`);
  getDb()
    .prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(key, String(value), nowMs());
  return getSetting(key);
}

function effectiveTranscriptProvider() {
  const { config } = require("../config");
  const override = getSetting("transcript_provider", null);
  if (override === "auto" || override === "yt-dlp" || override === "paste") return override;
  return config.transcriptProvider;
}

module.exports = { KEYS, getSetting, setSetting, effectiveTranscriptProvider };
