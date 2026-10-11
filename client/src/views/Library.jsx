import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import api from "../api.js";
import { STATUS, timeAgo, apiError } from "../lib.js";

function SourceCard({ source, onOpen, onToggleStar }) {
  const st = STATUS[source.status] || STATUS.queued;
  const preview = source.preview || {};
  const thumb = source.thumbnailUrl;
  const initial = String(source.title || source.creator || source.url || "?").trim().charAt(0).toUpperCase();
  const tags = (preview.tags || []).slice(0, 3);
  return (
    <div className="card lib-card" onClick={() => onOpen(source.id)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(source.id); }}>
      <div className="lib-thumb" aria-hidden>
        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="lib-avatar">{initial}</span>}
      </div>
      <div className="lib-body">
        <div className="card-top">
          <span className="card-title lib-title">{source.title || source.url}</span>
          <button
            className={`star${source.starred ? " on" : ""}`}
            title={source.starred ? "Unstar" : "Star"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(source);
            }}
          >
            ★
          </button>
        </div>
        <div className="lib-meta-row">
          <span className={`pill ${st.cls}`}>{st.label}</span>
          <span className="pill type">{source.sourceType}</span>
          {source.creator && <span className="card-meta">{source.creator}</span>}
          <span className="card-meta">· {timeAgo(source.updatedAt)}</span>
          {preview.blockCount > 0 && <span className="card-meta">· {preview.blockCount} notes</span>}
        </div>
        {preview.tldr && <div className="lib-tldr">{preview.tldr}</div>}
        {tags.length > 0 && (
          <div className="lib-tags">
            {tags.map((t) => (
              <span key={t} className="tag-chip">#{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Library({ go }) {
  const [url, setUrl] = useState("");
  const [hint, setHint] = useState("auto");
  const [capturing, setCapturing] = useState(false);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [sort, setSort] = useState("updated");
  const [syncing, setSyncing] = useState(false);

  const fetchSources = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await api.get("/sources", {
        params: {
          q: q || undefined,
          status: statusF !== "all" ? statusF : undefined,
          starred: starredOnly ? "1" : undefined,
          sort,
          limit: 100,
        },
      });
      setSources(res.data.sources || []);
    } catch (err) {
      if (!quiet) toast.error(apiError(err, "Failed to load library"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [q, statusF, starredOnly, sort]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const capture = async (e) => {
    e.preventDefault();
    if (!url.trim() || capturing) return;
    setCapturing(true);
    try {
      const body = { url: url.trim() };
      if (hint !== "auto") body.sourceType = hint;
      const res = await api.post("/capture", body);
      setUrl("");
      toast.success("Captured — fetching transcript…");
      go({ view: "source", id: res.data.source.id });
    } catch (err) {
      if (err && err.response && err.response.status === 409) {
        toast("Already in your library — opening it.");
        go({ view: "source", id: err.response.data.source.id });
      } else {
        toast.error(apiError(err, "Capture failed"));
      }
    } finally {
      setCapturing(false);
      fetchSources();
    }
  };

  const toggleStar = async (source) => {
    try {
      await api.patch(`/sources/${source.id}`, { starred: !source.starred });
      fetchSources();
    } catch (err) {
      toast.error(apiError(err, "Failed to star"));
    }
  };

  // Manual hub sync: the worker pulls + imports, then pushes. Refresh quietly
  // a few times so newly synced sources appear without a loading flash.
  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await api.post("/sync/run");
      toast.success("Sync started — pulling hub changes, then pushing.");
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        await fetchSources(true);
      }
    } catch (err) {
      toast.error(apiError(err, "Sync failed"));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="view-head">
        <h1>Library</h1>
        <span className="spacer" />
        <button
          type="button"
          className="btn ghost"
          onClick={syncNow}
          disabled={syncing}
          title="Pull missing/newer pages from the backup hub, then push"
        >
          {syncing ? "Syncing…" : "⇅ Sync"}
        </button>
      </div>
      <form className="capture-bar" onSubmit={capture}>
        <input
          placeholder="Paste a YouTube link…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <select value={hint} onChange={(e) => setHint(e.target.value)} title="Source type hint">
          <option value="auto">Auto</option>
          <option value="youtube">YouTube</option>
          <option value="podcast">Podcast</option>
          <option value="blog">Blog</option>
          <option value="book">Book</option>
        </select>
        <button className="btn" type="submit" disabled={capturing}>
          {capturing ? "Capturing…" : "Capture"}
        </button>
      </form>
      <div className="filter-row">
        <input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} className="filter-q" />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="all">All states</option>
          <option value="complete">Ready</option>
          <option value="processing">Structuring</option>
          <option value="awaiting_paste">Needs transcript</option>
          <option value="fetching">Fetching</option>
          <option value="failed">Failed</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="updated">Recently active</option>
          <option value="opened">Recently opened</option>
        </select>
        <button
          type="button"
          className={`btn ghost check-pill${starredOnly ? " on" : ""}`}
          onClick={() => setStarredOnly(!starredOnly)}
          title="Show starred only"
        >
          ★ Starred
        </button>
      </div>
      {loading ? (
        <div className="loading">Loading…</div>
      ) : sources.length === 0 ? (
        <div className="empty">Nothing here yet — paste a YouTube link above to start your knowledge base.</div>
      ) : (
        <div className="library-grid">
          {sources.map((s) => (
            <SourceCard key={s.id} source={s} onOpen={(id) => go({ view: "source", id })} onToggleStar={toggleStar} />
          ))}
        </div>
      )}
    </div>
  );
}
