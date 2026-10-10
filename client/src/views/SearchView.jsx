import { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import api from "../api.js";
import { fmtTime, apiError } from "../lib.js";
import { stripHashtags } from "../components/Outline.jsx";

// Renders an FTS snippet with <mark> highlights (server-escaped content,
// marks injected by SQLite snippet()).
function Snippet({ html }) {
  const parts = useMemo(() => {
    const out = [];
    const re = /<mark>(.*?)<\/mark>/g;
    let last = 0;
    let m;
    let k = 0;
    while ((m = re.exec(String(html || ""))) !== null) {
      if (m.index > last) out.push(<span key={k++}>{String(html).slice(last, m.index)}</span>);
      out.push(<mark key={k++}>{m[1]}</mark>);
      last = m.index + m[0].length;
    }
    if (last < String(html || "").length) out.push(<span key={k++}>{String(html).slice(last)}</span>);
    return out;
  }, [html]);
  return <div className="snippet">{parts}</div>;
}

function Hit({ hit, go, onConcept }) {
  const kind = (hit.block.props && hit.block.props.kind) || "note";
  const ts = hit.block.props && hit.block.props.timestamp;
  return (
    <div className="search-hit" onClick={() => go({ view: "source", id: hit.sourceId })}>
      <div className="hit-top">
        <span className={`kind-badge ${kind}`}>{kind}</span>
        {hit.matchType === "or" && <span className="pill related">related</span>}
        {hit.matchReason === "alias" && <span className="why-chip">via alias</span>}
        {hit.matchReason === "tag" && <span className="why-chip">via tag</span>}
        {ts != null && <span className="card-meta">▶ {fmtTime(ts)}</span>}
      </div>
      {hit.snippet ? (
        <Snippet html={hit.snippet} />
      ) : (
        <div className="snippet">{stripHashtags(hit.block.content).slice(0, 220)}</div>
      )}
      {(hit.matchedTags || []).length > 0 && (
        <div className="hit-tags">
          {hit.matchedTags.map((t) => (
            <span key={t} className="tag-chip">#{t}</span>
          ))}
        </div>
      )}
      <div className="src">
        {hit.sourceTitle || hit.pageTitle}
        {onConcept && hit.concepts && hit.concepts.length > 0 && (
          <span className="hit-concepts">
            {" · "}
            {hit.concepts.slice(0, 3).map((c) => (
              <button
                key={c.conceptId}
                className="concept-chip"
                onClick={(e) => {
                  e.stopPropagation();
                  onConcept(c.conceptId);
                }}
              >
                [[{c.name}]]
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

export default function SearchView({ initial = "", go }) {
  const [q, setQ] = useState(initial);
  const [payload, setPayload] = useState(null);
  const [expanded, setExpanded] = useState([]);
  const [searching, setSearching] = useState(false);

  const search = async (query) => {
    const queryText = (query !== undefined ? query : q).trim();
    if (queryText.length < 2 || searching) return;
    setSearching(true);
    try {
      const res = await api.get("/search", { params: { q: queryText, limit: 30 } });
      setPayload({ q: queryText, results: res.data.results || [] });
      setExpanded(res.data.expanded || []);
    } catch (err) {
      toast.error(apiError(err, "Search failed"));
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (initial && initial.trim().length >= 2) search(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    if (!payload) return [];
    const order = [];
    const bySource = new Map();
    for (const r of payload.results) {
      if (!bySource.has(r.sourceId)) {
        bySource.set(r.sourceId, { sourceId: r.sourceId, title: r.sourceTitle || r.pageTitle, hits: [] });
        order.push(r.sourceId);
      }
      bySource.get(r.sourceId).hits.push(r);
    }
    return order.map((id) => bySource.get(id));
  }, [payload]);

  const andCount = (payload?.results || []).filter((r) => r.matchType !== "or").length;

  return (
    <div>
      <div className="view-head">
        <h1>Search</h1>
      </div>
      <form
        className="capture-bar"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input
          placeholder="Search notes, transcripts, aliases… (min 2 chars)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <button className="btn" type="submit" disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {payload === null ? (
        <div className="empty">Keyword search across every note — including AI-written aliases and tags.</div>
      ) : payload.results.length === 0 ? (
        <div className="empty">No matches. Try fewer or different words.</div>
      ) : (
        <div>
          <div className="card-meta search-meta">
            {payload.results.length} hit{payload.results.length === 1 ? "" : "s"} for “{payload.q}”
            {andCount < payload.results.length && ` · ${andCount} exact + ${payload.results.length - andCount} related`}
            {expanded.length > 0 && ` · via [[${expanded.slice(0, 3).join("]], [[")}]]`}
          </div>
          {groups.map((g) => (
            <div key={g.sourceId} className="search-group">
              <div
                className="search-group-head"
                onClick={() => go({ view: "source", id: g.sourceId })}
              >
                {g.title} <span className="card-meta">· {g.hits.length} hit{g.hits.length === 1 ? "" : "s"}</span>
              </div>
              {g.hits.map((r) => (
                <Hit key={r.block.id} hit={r} go={go} onConcept={(cid) => go({ view: "concept", id: cid })} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
