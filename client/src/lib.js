// Tiny client helpers (revamp P1). No dependencies.

export function fmtTime(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "";
  const total = Math.max(0, Math.floor(Number(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function deepLink(url, seconds) {
  if (!url || seconds == null || !Number.isFinite(Number(seconds))) return null;
  const sep = String(url).includes("?") ? "&" : "?";
  return `${url}${sep}t=${Math.floor(Number(seconds))}`;
}

export function timeAgo(ms) {
  if (!ms) return "never";
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

export const STATUS = {
  queued: { label: "Queued", cls: "queued" },
  fetching: { label: "Fetching…", cls: "fetching" },
  awaiting_paste: { label: "Needs transcript", cls: "awaiting_paste" },
  processing: { label: "Structuring…", cls: "processing" },
  complete: { label: "Ready", cls: "complete" },
  failed: { label: "Failed", cls: "failed" },
};

export const ACTIVE_STATUSES = new Set(["queued", "fetching", "processing"]);

export function apiError(err, fallback) {
  const serverMsg = err && err.response && err.response.data && err.response.data.error;
  return serverMsg || (err && err.message) || fallback || "Request failed";
}
