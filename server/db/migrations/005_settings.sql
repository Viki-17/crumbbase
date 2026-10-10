-- 005_settings.sql — DB-backed runtime settings (P2 settings page).
-- Single-user server settings that apply WITHOUT a restart (unlike .env):
--   transcript_provider  TRANSCRIPT_PROVIDER override (auto | yt-dlp | paste)
-- .env stays the fallback; a row here wins. YouTube cookies are NOT stored
-- here — they live as a 0600 file at <DATA_DIR>/youtube-cookies.txt and the
-- API only ever reports exists/updatedAt, never contents.

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
