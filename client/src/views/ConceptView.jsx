import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import ReactMarkdown from "react-markdown";
import api from "../api.js";
import { fmtTime, apiError } from "../lib.js";
import { stripHashtags } from "../components/Outline.jsx";

// Concept page: Linked references (Logseq pattern) grouped by source, plus
// the Unlinked queue — suggested blocks with one-click Accept / Reject.
function LinkedHit({ hit, go }) {
  const kind = (hit.block.props && hit.block.props.kind) || "note";
  const ts = hit.block.props && hit.block.props.timestamp;
  return (
    <div className="search-hit" onClick={() => go({ view: "source", id: hit.sourceId })}>
      <div className="hit-top">
        <span className={`kind-badge ${kind}`}>{kind}</span>
        <span className="why-chip">{hit.linkOrigin || "linked"}</span>
        {ts != null && <span className="card-meta">▶ {fmtTime(ts)}</span>}
      </div>
      <div className="snippet">{stripHashtags(hit.block.content).slice(0, 240)}</div>
      {hit.linkEvidence && <div className="evidence">“{hit.linkEvidence}”</div>}
      <div className="src">{hit.sourceTitle || hit.pageTitle}</div>
    </div>
  );
}

function UnlinkedHit({ hit, go, onAccept, onReject, busy }) {
  const kind = (hit.block.props && hit.block.props.kind) || "note";
  return (
    <div className="search-hit suggest">
      <div className="hit-top">
        <span className={`kind-badge ${kind}`}>{kind}</span>
        <span className="pill related">suggested</span>
      </div>
      <div
        className="snippet"
        style={{ cursor: "pointer" }}
        onClick={() => go({ view: "source", id: hit.sourceId })}
      >
        {stripHashtags(hit.block.content).slice(0, 240)}
      </div>
      <div className="src">{hit.sourceTitle || hit.pageTitle}</div>
      <div className="suggest-actions">
        <button className="mini-btn" disabled={busy} onClick={() => onAccept(hit)}>Link ✓</button>
        <button className="mini-btn" disabled={busy} onClick={() => onReject(hit)}>Dismiss</button>
      </div>
    </div>
  );
}

export default function ConceptView({ id, go }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/concepts/${id}`);
      setData(res.data);
    } catch (err) {
      toast.error(apiError(err, "Failed to load concept"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (verb, hit) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/concepts/${id}/${verb}`, { blockId: hit.block.id });
      toast.success(verb === "accept" ? "Linked." : "Dismissed.");
      load();
    } catch (err) {
      toast.error(apiError(err, "Failed"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="loading">Loading…</div>;
  if (!data) return <div className="empty">Concept not found.</div>;

  const { concept, linked = [], unlinked = [] } = data;
  const bySource = new Map();
  for (const h of linked) {
    if (!bySource.has(h.sourceId)) bySource.set(h.sourceId, []);
    bySource.get(h.sourceId).push(h);
  }

  return (
    <div>
      <div className="view-head">
        <button className="btn ghost" onClick={() => go({ view: "concepts" })}>← Concepts</button>
      </div>
      <h2 className="page-title">[[{concept.name}]]</h2>
      <div className="page-sub">
        {linked.length} linked note{linked.length === 1 ? "" : "s"}
        {(concept.aliases || []).length > 0 && ` · aka ${concept.aliases.join(", ")}`}
        {concept.status === "provisional" && " · provisional (new — needs a 2nd source or your confirm)"}
      </div>

      <div className="outline-section">Linked references · {linked.length}</div>
      {linked.length === 0 ? (
        <div className="empty">Nothing linked yet.</div>
      ) : (
        [...bySource.entries()].map(([sid, hits]) => (
          <div key={sid} className="search-group">
            <div className="search-group-head" onClick={() => go({ view: "source", id: sid })}>
              {hits[0].sourceTitle || hits[0].pageTitle}{" "}
              <span className="card-meta">· {hits.length}</span>
            </div>
            {hits.map((h) => (
              <LinkedHit key={h.block.id} hit={h} go={go} />
            ))}
          </div>
        ))
      )}

      <div className="outline-section">Unlinked mentions · {unlinked.length}</div>
      {unlinked.length === 0 ? (
        <div className="card-meta">No unlinked mentions found — every match is already linked.</div>
      ) : (
        <div className="card-meta" style={{ marginBottom: 8 }}>
          Blocks that mention “{concept.name}” without a link. Confirm to link, dismiss to never suggest again.
        </div>
      )}
      {unlinked.map((h) => (
        <UnlinkedHit
          key={h.block.id}
          hit={h}
          go={go}
          busy={busy}
          onAccept={(hit) => act("accept", hit)}
          onReject={(hit) => act("reject", hit)}
        />
      ))}
    </div>
  );
}
