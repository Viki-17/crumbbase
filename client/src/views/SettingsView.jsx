import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import api from "../api.js";
import { apiError } from "../lib.js";

const TOKEN_KEY = "cb-settings-token";

// Settings (P2): status dashboard + transcript provider + YouTube cookies.
// The settings token lives in sessionStorage only (never localStorage) and
// cookie file CONTENTS are write-only — the API only reports exists/updatedAt.
function authed(token) {
  return { headers: { "x-settings-token": token } };
}

function fmtTime(ms) {
  if (!ms) return "never";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

export default function SettingsView() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const [tokenInput, setTokenInput] = useState("");
  const [needsToken, setNeedsToken] = useState(false);
  const [status, setStatus] = useState(null);
  const [publicStatus, setPublicStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState("auto");
  const [savingProvider, setSavingProvider] = useState(false);
  const [cookiesText, setCookiesText] = useState("");
  const [savingCookies, setSavingCookies] = useState(false);
  const [testUrl, setTestUrl] = useState("");
  const [testing, setTesting] = useState(false);

  const load = useCallback(
    async (t) => {
      setLoading(true);
      try {
        const [s, pub] = await Promise.all([
          api.get("/settings", authed(t)),
          api.get("/setup/status"),
        ]);
        setStatus(s.data);
        setPublicStatus(pub.data);
        setProvider(s.data.transcriptProvider || "auto");
        setNeedsToken(false);
      } catch (e) {
        if (e && e.response && e.response.status === 403) {
          setNeedsToken(true);
          const msg =
            (e.response.data && e.response.data.error) || "Settings locked.";
          toast.error(msg);
        } else {
          toast.error(apiError(e));
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (token) load(token);
    else setNeedsToken(true);
  }, [token, load]);

  const unlock = (e) => {
    e.preventDefault();
    const t = tokenInput.trim();
    if (!t) return;
    sessionStorage.setItem(TOKEN_KEY, t);
    setToken(t);
    setTokenInput("");
  };

  const lock = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setStatus(null);
    setCookiesText("");
    setNeedsToken(true);
  };

  const saveProvider = async () => {
    setSavingProvider(true);
    try {
      const r = await api.put("/settings/provider", { provider }, authed(token));
      toast.success(`Transcript provider: ${r.data.transcriptProvider}`);
      load(token);
    } catch (e) {
      if (e && e.response && e.response.status === 403) setNeedsToken(true);
      toast.error(apiError(e));
    } finally {
      setSavingProvider(false);
    }
  };

  const saveCookies = async () => {
    if (!cookiesText.trim()) {
      toast.error("Paste the cookies file contents first.");
      return;
    }
    setSavingCookies(true);
    try {
      await api.put("/settings/cookies", { text: cookiesText }, authed(token));
      setCookiesText(""); // never keep secrets in the DOM longer than needed
      toast.success("Cookies saved.");
      load(token);
    } catch (e) {
      if (e && e.response && e.response.status === 403) setNeedsToken(true);
      toast.error(apiError(e));
    } finally {
      setSavingCookies(false);
    }
  };

  const clearCookies = async () => {
    setSavingCookies(true);
    try {
      await api.delete("/settings/cookies", authed(token));
      setCookiesText("");
      toast.success("Cookies removed.");
      load(token);
    } catch (e) {
      if (e && e.response && e.response.status === 403) setNeedsToken(true);
      toast.error(apiError(e));
    } finally {
      setSavingCookies(false);
    }
  };

  const testFetch = async () => {
    if (!testUrl.trim()) {
      toast.error("Enter a video URL to test.");
      return;
    }
    setTesting(true);
    try {
      const r = await api.post(
        "/settings/cookies/test",
        { url: testUrl.trim() },
        authed(token),
      );
      toast.success(`Fetch OK: ${r.data.title || "untitled"}`);
    } catch (e) {
      if (e && e.response && e.response.status === 403) setNeedsToken(true);
      toast.error(apiError(e));
    } finally {
      setTesting(false);
    }
  };

  if (needsToken && !status) {
    return (
      <div className="narrow">
        <div className="view-head"><h1>Settings</h1></div>
        <p className="card-meta">
          This area controls the capture pipeline. Enter the server's settings
          token to unlock (kept for this tab only).
        </p>
        <form onSubmit={unlock} className="capture-bar">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Settings token (SETTINGS_TOKEN)"
            autoComplete="off"
          />
          <button type="submit" className="btn">Unlock</button>
        </form>
      </div>
    );
  }

  const cookies = (status && status.cookies) || {};
  const tools = (status && status.tools) || {};
  const backup = (status && status.backup) || {};
  const ai = (publicStatus && publicStatus.ai) || {};

  return (
    <div className="narrow">
      <div className="view-head">
        <h1>Settings</h1>
        <span className="spacer" />
        <button className="btn ghost" onClick={lock}>Lock</button>
      </div>
      {loading && !status && <p className="card-meta">Loading…</p>}

      <section className="card stack">
        <h3>Status</h3>
        <div className="kv">
          <span>Runtime</span>
          <span>{(publicStatus && publicStatus.runtime) || "…"}</span>
          <span>yt-dlp / ffmpeg</span>
          <span>{tools.ytdlpAvailable ? "yes" : "no"} / {tools.ffmpegAvailable ? "yes" : "no"}</span>
          <span>AI sidecar</span>
          <span>{ai.opencodeReachable ? `reachable (${ai.opencodeServerUrl || ""})` : "unreachable"}</span>
          <span>Backup</span>
          <span>{backup.enabled ? `on (${backup.branch || "main"})` : "off"}{backup.lastBackupAt ? ` · last ${fmtTime(backup.lastBackupAt)}` : ""}</span>
        </div>
        <p className="card-meta">
          <a href="/api/setup/status" target="_blank" rel="noreferrer">view raw JSON</a>
        </p>
      </section>

      <section className="card stack">
        <h3>Transcript provider</h3>
        <p className="card-meta">
          auto = try yt-dlp, fall back to paste · yt-dlp = fail loudly ·
          paste = never fetch. Applies immediately, no restart.
          {status && status.transcriptProviderSource === "settings" ? " (set here)" : " (from server .env)"}
        </p>
        <div className="capture-bar">
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="auto">auto</option>
            <option value="yt-dlp">yt-dlp</option>
            <option value="paste">paste</option>
          </select>
          <button className="btn" onClick={saveProvider} disabled={savingProvider}>
            {savingProvider ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      <section className="card stack">
        <h3>YouTube cookies</h3>
        <p className="card-meta">
          Beats YouTube's "sign in to confirm you're not a bot" on server IPs.
          Paste a Netscape cookies file with youtube.com included
          (browser extension "Get cookies.txt LOCALLY"). Stored 0600 on the
          server, never shown back. Current: {cookies.fileExists ? `saved · updated ${fmtTime(cookies.updatedAt)}` : "none"}.
        </p>
        <div className="paste-box">
          <textarea
            value={cookiesText}
            onChange={(e) => setCookiesText(e.target.value)}
            placeholder="# Netscape HTTP Cookie File…"
            rows={5}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="btn-row">
          <button className="btn" onClick={saveCookies} disabled={savingCookies}>
            {savingCookies ? "Saving…" : "Save cookies"}
          </button>
          {cookies.fileExists && (
            <button className="btn ghost danger" onClick={clearCookies} disabled={savingCookies}>
              Remove
            </button>
          )}
        </div>
        <h4>Test fetch</h4>
        <div className="capture-bar">
          <input
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            placeholder="https://youtu.be/…"
            inputMode="url"
          />
          <button className="btn ghost" onClick={testFetch} disabled={testing}>
            {testing ? "Testing…" : "Test"}
          </button>
        </div>
      </section>
    </div>
  );
}
