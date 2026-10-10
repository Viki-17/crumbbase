import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import api from "../api.js";
import Outline, { stripHashtags } from "../components/Outline.jsx";
import CardDeck from "../components/CardDeck.jsx";
import { conceptsByBlock } from "../components/ConceptChips.jsx";
import { STATUS, ACTIVE_STATUSES, fmtTime, apiError } from "../lib.js";

export default function SourceView({ id, go }) {
  const [detail, setDetail] = useState(null);
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem("crumbbase-view") || "outline";
    } catch {
      return "outline";
    }
  });

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/sources/${id}`);
      setDetail(res.data);
      if (res.data.page) {
        try {
          const p = await api.get(`/pages/${res.data.page.id}`);
          setPage(p.data);
        } catch {
          setPage(null);
        }
      } else {
        setPage(null);
      }
    } catch (err) {
      toast.error(apiError(err, "Failed to load source"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while the pipeline is working (ingest/structure ticks).
  useEffect(() => {
    if (!detail || !ACTIVE_STATUSES.has(detail.status)) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [detail, load]);

  const submitPaste = async (e) => {
    e.preventDefault();
    if (pasteText.trim().length < 20 || pasting) return;
    setPasting(true);
    try {
      await api.post(`/sources/${id}/paste`, { text: pasteText.trim() });
      setPasteText("");
      toast.success("Transcript saved — structuring…");
      load();
    } catch (err) {
      toast.error(apiError(err, "Paste failed"));
    } finally {
      setPasting(false);
    }
  };

  const toggleStar = async () => {
    try {
      const res = await api.patch(`/sources/${id}`, { starred: !detail.starred });
      setDetail({ ...detail, starred: res.data.source.starred });
    } catch (err) {
      toast.error(apiError(err, "Failed to star"));
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this source and all its notes?")) return;
    try {
      await api.delete(`/sources/${id}`);
      toast.success("Deleted.");
      go({ view: "library" });
    } catch (err) {
      toast.error(apiError(err, "Delete failed"));
    }
  };

  const setMode = (m) => {
    setViewMode(m);
    try {
      localStorage.setItem("crumbbase-view", m);
    } catch {}
  };

  const copyPage = async () => {
    if (!page || !page.blocks) return;
    const lines = [`# ${detail.title || "Untitled"}`, ""];
    for (const b of page.blocks) {
      const kind = (b.props && b.props.kind) || "note";
      if (kind === "transcript-chunk") continue;
      lines.push(`- ${stripHashtags(b.content)}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Page copied as markdown.");
    } catch {
      toast.error("Copy failed.");
    }
  };

  const [zettelBusy, setZettelBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  const makeCards = async () => {
    if (zettelBusy) return;
    setZettelBusy(true);
    try {
      // Try AI draft first (sidecar flash); falls back to local split server-side.
      const prev = await api.get(`/sources/${id}/zettels/preview`, { params: { ai: "1" } });
      const draft = prev.data.draft || [];
      if (draft.length === 0) {
        toast(prev.data.existing > 0 ? "Cards already exist — nothing new." : "Nothing to split yet.");
        return;
      }
      const res = await api.post(`/sources/${id}/zettels/commit`, { cards: draft });
      toast.success(
        res.data.written > 0
          ? `Made ${res.data.written} bite-sized cards (${prev.data.origin === "ai" ? "AI" : "local split"}).`
          : "Cards already exist — nothing new.",
      );
      if (res.data.written > 0) setMode("cards");
      load();
    } catch (err) {
      toast.error(apiError(err, "Card generation failed"));
    } finally {
      setZettelBusy(false);
    }
  };

  const extractConcepts = async () => {
    if (linkBusy) return;
    setLinkBusy(true);
    try {
      await api.post(`/sources/${id}/concepts/extract`);
      toast.success("Concept extraction queued — links appear in a few seconds.");
      setTimeout(load, 4000);
    } catch (err) {
      toast.error(apiError(err, "Extraction failed"));
    } finally {
      setLinkBusy(false);
    }
  };

  if (loading) return <div className="loading">Loading…</div>;
  if (!detail) return <div className="empty">Source not found.</div>;

  const st = STATUS[detail.status] || STATUS.queued;

  return (
    <div className="source-wrap">
      <div className="view-head sticky-head">
        <button className="btn ghost" onClick={() => go({ view: "library" })}>← Library</button>
        <div className="spacer" />
        <div className="view-toggle" role="tablist" aria-label="View mode">
          {["outline", "cards", "focus"].map((m) => (
            <button
              key={m}
              className={`toggle-btn${viewMode === m ? " on" : ""}`}
              onClick={() => setMode(m)}
              title={m === "outline" ? "Outline view" : m === "cards" ? "Bite-sized cards" : "Focus: one card at a time"}
            >
              {m}
            </button>
          ))}
        </div>
        <button className={`star${detail.starred ? " on" : ""}`} onClick={toggleStar} title="Star">★</button>
      </div>

      <div className="hero">
        {detail.thumbnailUrl && (
          <img className="hero-thumb" src={detail.thumbnailUrl} alt="" loading="lazy" />
        )}
        <div className="hero-body">
          <h2 className="page-title">{detail.title || "Untitled"}</h2>
          <div className="page-sub">
            {[detail.creator, detail.sourceType, detail.durationSeconds != null ? fmtTime(detail.durationSeconds) : null]
              .filter(Boolean)
              .join(" · ")}
            {page && page.blockCount > 0 && ` · ${page.blockCount} notes`}
          </div>
          <div className="page-sub">
            <a className="src-link" href={detail.url} target="_blank" rel="noreferrer">{detail.url}</a>
          </div>
        </div>
      </div>
      <div className="row-actions">
        <span className={`pill ${st.cls}`}>{st.label}</span>
        {detail.error && <span className="pill failed">{detail.error.slice(0, 120)}</span>}
        <div className="spacer" />
        {detail.status === "complete" && (
          <button className="btn" onClick={makeCards} disabled={zettelBusy} title="Split key ideas into bite-sized Zettel cards (AI if sidecar up, else local)">
            {zettelBusy ? "Making…" : "✨ Make cards"}
          </button>
        )}
        {detail.status === "complete" && (!page || !page.concepts || page.concepts.length === 0) && (
          <button className="btn ghost" onClick={extractConcepts} disabled={linkBusy} title="Extract named concepts and link ideas (backfills notes made before P2)">
            {linkBusy ? "Queuing…" : "Link concepts"}
          </button>
        )}
        <button className="btn ghost" onClick={copyPage} title="Copy notes as markdown">Copy MD</button>
        <a className="btn ghost" href={detail.url} target="_blank" rel="noreferrer">Open ↗</a>
        <button className="btn ghost danger" onClick={remove}>Delete</button>
      </div>

      {page && page.tags && page.tags.length > 0 && (
        <div className="tag-row hero-tags">
          {(tagsOpen ? page.tags : page.tags.slice(0, 8)).map((t) => (
            <button key={t} className="tag-chip clickable" onClick={() => go({ view: "search", q: t })} title={`Search #${t}`}>
              #{t}
            </button>
          ))}
          {page.tags.length > 8 && (
            <button className="tags-toggle" onClick={() => setTagsOpen((v) => !v)}>
              {tagsOpen ? "Show less ▴" : `Show all ${page.tags.length} tags ▾`}
            </button>
          )}
        </div>
      )}

      {detail.status === "awaiting_paste" && (
        <div className="banner">
          <strong>Auto-fetch couldn't get this transcript.</strong> Open the video description (or
          YouTube's transcript panel), copy the text, and paste it below — the pipeline resumes
          automatically.
          <form className="paste-box" onSubmit={submitPaste}>
            <textarea
              placeholder="Paste transcript text here (min 20 characters)…"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button className="btn" type="submit" disabled={pasting || pasteText.trim().length < 20}>
              {pasting ? "Saving…" : "Save transcript"}
            </button>
          </form>
        </div>
      )}

      {detail.status === "failed" && (
        <div className="banner">
          <strong>Something failed.</strong> Check the log below, then re-paste the transcript or
          delete and re-capture.
        </div>
      )}

      {page && page.blocks && viewMode === "outline" && (
        <Outline
          blocks={page.blocks}
          tags={[]}
          sourceUrl={detail.url}
          sourceTitle={detail.title}
          onTagClick={(t) => go({ view: "search", q: t })}
          conceptsByBlock={conceptsByBlock(page.concepts || [])}
          onConceptClick={(conceptId) => go({ view: "concept", id: conceptId })}
        />
      )}

      {page && page.blocks && viewMode !== "outline" && (
        <CardDeck
          blocks={page.blocks}
          sourceUrl={detail.url}
          sourceTitle={detail.title}
          mode={viewMode}
          conceptsByBlock={conceptsByBlock(page.concepts || [])}
          onConceptClick={(conceptId) => go({ view: "concept", id: conceptId })}
        />
      )}

      {detail.transcript && detail.transcript.segments && detail.transcript.segments.length > 0 && (
        <details className="collapsible">
          <summary>
            Raw transcript · {detail.transcript.segmentCount} segments ({detail.transcript.origin})
          </summary>
          <div className="coll-body">
            {detail.transcript.segments.slice(0, 300).map((s, i) => (
              <div className="seg" key={i}>
                {s.start != null && detail.transcript.origin === "caption" && (
                  <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{fmtTime(s.start)} </span>
                )}
                {s.text}
              </div>
            ))}
          </div>
        </details>
      )}

      {detail.logs && detail.logs.length > 0 && (
        <details className="collapsible">
          <summary>Processing log · {detail.logs.length}</summary>
          <div className="coll-body">
            {detail.logs.map((l) => (
              <div key={l.id} className={`log-row ${l.level}`}>
                [{l.level}] {l.message}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
