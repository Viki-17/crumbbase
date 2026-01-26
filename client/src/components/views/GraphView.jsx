import React, { useState, useEffect, useCallback } from "react";
import api from "../../api";
import ForceGraph2D from "react-force-graph-2d";
import { Network, ArrowLeft } from "lucide-react";
import Loading from "./../layout/Loading";
import "./../../styles/graph-view.css";

/**
 * GraphView - Interactive force-directed graph visualization
 *
 * Features:
 * - Nodes: Atomic notes
 * - Edges: Links from graph
 * - Filters: Manual vs AI links, confidence threshold, tags
 * - Interactions: Hover (show title), Click (open note)
 */
const GraphView = ({ onSelectNote, onBack }) => {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [allNotes, setAllNotes] = useState([]);
  const [showManualLinks, setShowManualLinks] = useState(true);
  const [showAILinks, setShowAILinks] = useState(true);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [loading, setLoading] = useState(true);

  /* useRef to persist raw data without re-fetching */
  const rawGraphData = React.useRef({ nodes: {}, edges: [] });

  useEffect(() => {
    fetchGraphData();
  }, []); // Only fetch once on mount

  const fetchGraphData = async () => {
    try {
      setLoading(true);
      const [graphRes, notesRes] = await Promise.all([
        api.get("/graph"),
        api.get("/notes?all=true"), // Get all notes, not paginated
      ]);

      // Handle paginated response - extract notes array
      setAllNotes(notesRes.data.notes || notesRes.data || []);
      rawGraphData.current = graphRes.data;

      console.log("Graph Data Fetched:", {
        nodes: (notesRes.data.notes || notesRes.data || []).length,
        edges: graphRes.data.edges?.length,
        edgesSample: graphRes.data.edges?.slice(0, 3),
      });

      // Removed redundant buildFilteredGraph() call here to avoid double render
      // The useEffect hook will trigger it when allNotes updates
    } catch (err) {
      console.error("Failed to fetch graph:", err);
    } finally {
      setLoading(false);
    }
  };

  // Memoize buildFilteredGraph to prevent infinite loops
  const buildFilteredGraph = useCallback(() => {
    const rawGraph = rawGraphData.current;

    if (!allNotes || allNotes.length === 0) {
      console.log("No notes yet, skipping graph build");
      return;
    }

    // Build nodes from notes - Ensure IDs are strings
    const nodes = allNotes.map((note) => ({
      id: String(note.id),
      name: note.title,
      tags: note.tags || [],
      val:
        1 +
        (rawGraph.edges?.filter(
          (e) =>
            String(e.from) === String(note.id) ||
            String(e.to) === String(note.id),
        ).length || 0),
    }));

    // Filter edges based on filters
    let edges = rawGraph.edges || [];

    if (!showManualLinks) {
      edges = edges.filter((e) => e.createdBy !== "manual");
    }

    if (!showAILinks) {
      edges = edges.filter((e) => e.createdBy !== "ai");
    }

    edges = edges.filter(
      (e) => !e.confidence || e.confidence >= confidenceThreshold,
    );

    // Convert to graph format with explicit string IDs for source/target
    const links = edges.map((e) => ({
      source: String(e.from),
      target: String(e.to),
      type: e.createdBy,
      reason: e.reason,
      confidence: e.confidence,
    }));

    console.log("Links for graph:", {
      nodeCount: nodes.length,
      linkCount: links.length,
    });

    setGraphData({ nodes, links });
  }, [allNotes, showManualLinks, showAILinks, confidenceThreshold]);

  // Rebuild graph when filters change
  useEffect(() => {
    buildFilteredGraph();
  }, [buildFilteredGraph]);

  const handleNodeClick = useCallback(
    (node) => {
      console.log("Node Clicked:", node);
      if (onSelectNote && node && node.id) {
        onSelectNote(node.id);
      }
    },
    [onSelectNote],
  );

  const handleNodeHover = useCallback((node) => {
    // Change cursor
    document.body.style.cursor = node ? "pointer" : "default";
  }, []);

  if (loading) {
    return (
      <div className="graph-view">
        <Loading message="Loading graph..." />
      </div>
    );
  }

  if (graphData.nodes.length === 0) {
    return (
      <div className="graph-view">
        <div className="graph-view-header">
          <h2 className="graph-view-title">Graph View</h2>
        </div>
        <div className="graph-view-empty">
          <div className="graph-view-empty-icon">
            <Network size={64} />
          </div>
          <p>
            No notes in the graph yet.
            <br />
            Create some notes to visualize connections.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-view container">
      <div style={{ marginBottom: "1rem" }}>
        <button
          onClick={onBack}
          className="btn-ghost"
          style={{ paddingLeft: 0 }}
        >
          <ArrowLeft size={20} /> Back to Library
        </button>
      </div>
      <div className="graph-view-header">
        <h2 className="graph-view-title">Graph View</h2>

        <div className="graph-view-filters">
          <div className="graph-view-filter">
            <input
              type="checkbox"
              id="show-manual"
              checked={showManualLinks}
              onChange={(e) => setShowManualLinks(e.target.checked)}
            />
            <label htmlFor="show-manual">Manual Links</label>
          </div>

          <div className="graph-view-filter">
            <input
              type="checkbox"
              id="show-ai"
              checked={showAILinks}
              onChange={(e) => setShowAILinks(e.target.checked)}
            />
            <label htmlFor="show-ai">AI Links</label>
          </div>

          <div className="graph-view-filter">
            <span className="graph-view-filter-label">Confidence</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={confidenceThreshold}
              onChange={(e) =>
                setConfidenceThreshold(parseFloat(e.target.value))
              }
            />
            <span>{(confidenceThreshold * 100).toFixed(0)}%</span>
          </div>

          <button
            onClick={async () => {
              if (
                window.confirm(
                  "This will analyze all notes and generate connections. It may take a minute. Continue?",
                )
              ) {
                try {
                  await api.post("/graph/auto-connect");
                  alert(
                    "Analysis started in background. Refresh graph in a minute.",
                  );
                } catch (e) {
                  alert("Error: " + e.message);
                }
              }
            }}
            style={{
              marginLeft: "auto",
              background: "var(--accent-color)",
              color: "white",
              border: "none",
              padding: "0.5rem 1rem",
              borderRadius: "4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <Network size={16} /> Connect Notes
          </button>
        </div>
      </div>

      <div className="graph-view-canvas">
        <ForceGraph2D
          graphData={graphData}
          nodeLabel="name"
          nodeColor={(node) => "#6366f1"}
          nodeRelSize={6}
          linkColor={(link) => {
            // Make links visible with distinct colors
            if (link.type === "manual") return "#10b981"; // Green
            if (link.type === "ai") return "#f59e0b"; // Orange
            return "#94a3b8"; // Gray fallback
          }}
          linkWidth={2}
          linkDirectionalArrows={true}
          linkDirectionalArrowLength={3.5}
          linkDirectionalArrowRelPos={0.5}
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={2}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          backgroundColor="#1e293b"
          cooldownTicks={100}
          d3VelocityDecay={0.3}
        />

        <div className="graph-view-legend">
          <div className="graph-view-legend-title">Legend</div>
          <div className="graph-view-legend-item">
            <div
              className="graph-view-legend-color"
              style={{ background: "#6366f1" }}
            ></div>
            <span>Notes</span>
          </div>
          <div className="graph-view-legend-item">
            <div
              className="graph-view-legend-color"
              style={{ background: "#10b981" }}
            ></div>
            <span>Manual Links</span>
          </div>
          <div className="graph-view-legend-item">
            <div
              className="graph-view-legend-color"
              style={{ background: "#f59e0b" }}
            ></div>
            <span>AI Links</span>
          </div>
        </div>

        <div className="graph-view-stats">
          <span>{graphData.nodes.length} notes</span>
          <span>·</span>
          <span>{graphData.links.length} links</span>
        </div>
      </div>
    </div>
  );
};

export default GraphView;
