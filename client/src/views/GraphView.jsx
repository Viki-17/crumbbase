import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import api from "../api.js";
import { apiError } from "../lib.js";

const ROW_H = 40;
const PAD = 30;

// Bipartite graph: sources left, concepts right, edges = mentions.
// Static layout (no physics): readable and cheap for a single user.
export default function GraphView({ go }) {
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/graph").then(
      (res) => {
        setGraph(res.data);
        setLoading(false);
      },
      (err) => {
        toast.error(apiError(err, "Failed to load graph"));
        setLoading(false);
      },
    );
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (!graph || graph.nodes.length === 0) {
    return (
      <div>
        <div className="view-head"><h1>Graph</h1></div>
        <div className="empty">No links yet — press “Link concepts” on a finished source first.</div>
      </div>
    );
  }

  const sources = graph.nodes.filter((n) => n.type === "source").slice(0, 60);
  const concepts = graph.nodes.filter((n) => n.type === "concept").slice(0, 80);
  const W = 900;
  const H = Math.max(sources.length, concepts.length) * ROW_H + PAD * 2;
  const pos = new Map();
  sources.forEach((n, i) => pos.set(n.id, { x: 180, y: PAD + i * ROW_H + 12 }));
  concepts.forEach((n, i) => pos.set(n.id, { x: W - 180, y: PAD + i * ROW_H + 12 }));
  const maxW = Math.max(1, ...concepts.map((n) => n.weight || 1));

  const short = (s, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  return (
    <div>
      <div className="view-head">
        <h1>Graph</h1>
        <div className="spacer" />
        <span className="card-meta">{sources.length} sources · {concepts.length} concepts · {graph.edges.length} links</span>
      </div>
      <div className="graph-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} className="graph-svg" role="img" aria-label="Knowledge graph">
        {graph.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2;
          return (
            <path
              key={i}
              d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}
              className="graph-edge"
            />
          );
        })}
        {sources.map((n) => {
          const p = pos.get(n.id);
          return (
            <g key={n.id} className="graph-node" onClick={() => go({ view: "source", id: n.refId })}>
              <circle cx={p.x} cy={p.y} r={5} className="dot source" />
              <text x={p.x - 12} y={p.y + 4} textAnchor="end" className="graph-label">{short(n.label)}</text>
            </g>
          );
        })}
        {concepts.map((n) => {
          const p = pos.get(n.id);
          const r = 4 + 8 * Math.sqrt((n.weight || 1) / maxW);
          return (
            <g key={n.id} className="graph-node" onClick={() => go({ view: "concept", id: n.refId })}>
              <circle cx={p.x} cy={p.y} r={r} className="dot concept" />
              <text x={p.x + r + 6} y={p.y + 4} className="graph-label">[[{short(n.label, 30)}]]</text>
            </g>
          );
        })}
      </svg>
      </div>
    </div>
  );
}
