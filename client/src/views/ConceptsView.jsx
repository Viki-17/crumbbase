import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import api from "../api.js";
import { apiError } from "../lib.js";

export default function ConceptsView({ go }) {
  const [q, setQ] = useState("");
  const [concepts, setConcepts] = useState([]);
  const [emerging, setEmerging] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);

  const fetchAll = useCallback(async (query) => {
    setLoading(true);
    try {
      const [cRes, eRes, sRes] = await Promise.all([
        api.get("/concepts", { params: { q: query || undefined, limit: 100 } }),
        api.get("/concepts/emerging/list"),
        api.get("/suggestions"),
      ]);
      setConcepts(cRes.data.concepts || []);
      setEmerging(eRes.data.emerging || []);
      setSuggestions(sRes.data.suggestions || []);
    } catch (err) {
      toast.error(apiError(err, "Failed to load concepts"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll("");
  }, [fetchAll]);

  const sweep = async () => {
    if (sweeping) return;
    setSweeping(true);
    try {
      await api.post("/concepts/sweep");
      toast.success("Sweep queued — promotions and merge suggestions in a few seconds.");
      setTimeout(() => {
        fetchAll(q);
        setSweeping(false);
      }, 6000);
    } catch (err) {
      toast.error(apiError(err, "Sweep failed"));
      setSweeping(false);
    }
  };

  const resolve = async (id, verb) => {
    try {
      const res = await api.post(`/suggestions/${id}/${verb}`);
      if (verb === "accept" && res.data.result) {
        const r = res.data.result;
        toast.success(r.kind === "merge" ? `Merged “${r.loser}” into “${r.winner}”.` : `Alias added to [[${r.concept}]].`);
      } else {
        toast.success("Dismissed.");
      }
      fetchAll(q);
    } catch (err) {
      toast.error(apiError(err, "Failed"));
    }
  };

  return (
    <div>
      <div className="view-head">
        <h1>Concepts</h1>
        <div className="spacer" />
        <button className="btn ghost" onClick={sweep} disabled={sweeping} title="Cross-source sweep: promotions, duplicate review, emerging radar">
          {sweeping ? "Sweeping…" : "⟳ Sweep"}
        </button>
      </div>
      <form
        className="capture-bar"
        onSubmit={(e) => {
          e.preventDefault();
          fetchAll(q);
        }}
      >
        <input placeholder="Filter concepts…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" type="submit">Filter</button>
      </form>

      {suggestions.length > 0 && (
        <div>
          <div className="outline-section">Review merges · {suggestions.length}</div>
          {suggestions.map((s) => (
            <div key={s.id} className="search-hit suggest">
              <div className="hit-top">
                <span className="pill related">{s.kind}</span>
                <strong>{s.kind === "merge" ? `Fold duplicate into [[${s.conceptName}]]` : `Add alias to [[${s.conceptName}]]`}</strong>
              </div>
              {s.reason && <div className="card-meta">{s.reason}</div>}
              {s.kind === "alias" && s.payload.alias && (
                <div className="card-meta">alias: “{s.payload.alias}”</div>
              )}
              <div className="suggest-actions">
                <button className="mini-btn" onClick={() => resolve(s.id, "accept")}>Merge ✓</button>
                <button className="mini-btn" onClick={() => resolve(s.id, "reject")}>Keep separate</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {emerging.length > 0 && (
        <div>
          <div className="outline-section">Emerging · {emerging.length}</div>
          <div className="concept-grid">
            {emerging.map((c) => (
              <div key={c.id} className="card concept-card provisional" onClick={() => go({ view: "concept", id: c.id })}>
                <div className="card-top">
                  <span className="card-title">[[{c.name}]]</span>
                  <span className="pill related">new</span>
                </div>
                <div className="card-meta">
                  {c.blockCount} note{c.blockCount === 1 ? "" : "s"} · {c.sourceCount} source{c.sourceCount === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="outline-section">All concepts · {concepts.length}</div>
      {loading ? (
        <div className="loading">Loading…</div>
      ) : concepts.length === 0 ? (
        <div className="empty">
          No concepts yet. Open a finished source and press “Link concepts”, or finish a new capture — entity extraction runs automatically.
        </div>
      ) : (
        <div className="concept-grid">
          {concepts.map((c) => (
            <div key={c.id} className={`card concept-card${c.status === "provisional" ? " provisional" : ""}`} onClick={() => go({ view: "concept", id: c.id })}>
              <div className="card-top">
                <span className="card-title">[[{c.name}]]</span>
                {c.status === "provisional" && <span className="pill related">new</span>}
              </div>
              <div className="card-meta">
                {c.blockCount} note{c.blockCount === 1 ? "" : "s"} · {c.sourceCount} source{c.sourceCount === 1 ? "" : "s"}
              </div>
              {(c.aliases || []).length > 0 && (
                <div className="card-meta">aka {c.aliases.slice(0, 3).join(", ")}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
