// Validated runtime config (revamp P1: SQLite only — no connection strings).
// Fails fast with a clear message instead of obscure downstream errors.
require("dotenv").config();
const { z } = require("zod");

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  OPENCODE_SERVER_URL: z.string().default("http://127.0.0.1:4096"),
  // Model refs on the opencode-go provider (auth via `opencode auth login`).
  OPENCODE_PRO_MODEL: z.string().default("muse-spark-1.3-contributor"),
  OPENCODE_FLASH_MODEL: z.string().default("muse-spark-1.3-contributor"),
  // Revamp P0: SQLite lives under DATA_DIR (./data/crumbbase.db + pages mirror).
  DATA_DIR: z.string().default("./data"),
  // Transcript capture: auto = try yt-dlp, fall back to pasted text;
  // yt-dlp = fail loudly when fetch fails; paste = skip fetching entirely.
  TRANSCRIPT_PROVIDER: z.enum(["auto", "yt-dlp", "paste"]).default("auto"),
  // GitHub backup (P1 job pushes ./data mirror; P0 only reports health).
  GITHUB_BACKUP_ENABLED: z.string().default("false"),
  GITHUB_BACKUP_REPO: z.string().default(""),
  GITHUB_BACKUP_BRANCH: z.string().default("main"),
});

const parsed = envSchema.parse(process.env);

function isTruthy(value) {
  return value === "1" || String(value).toLowerCase() === "true";
}

const config = {
  port: parsed.PORT,
  opencodeServerUrl: parsed.OPENCODE_SERVER_URL,
  opencodeProModel: parsed.OPENCODE_PRO_MODEL,
  opencodeFlashModel: parsed.OPENCODE_FLASH_MODEL,
  dataDir: parsed.DATA_DIR,
  transcriptProvider: parsed.TRANSCRIPT_PROVIDER,
  githubBackupEnabled: isTruthy(parsed.GITHUB_BACKUP_ENABLED),
  githubBackupRepo: parsed.GITHUB_BACKUP_REPO,
  githubBackupBranch: parsed.GITHUB_BACKUP_BRANCH,
};

module.exports = { config, envSchema };
