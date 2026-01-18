import React, { useState, useEffect } from "react";
import api from "../../api";
import { X, Link2, Sparkles, ArrowRight, ArrowLeft } from "lucide-react";
import "./../../styles/context-panel.css";

/**
 * ContextPanel - Right panel for note context
 */
const ContextPanel = ({ selectedNote, selectedBook, onClose }) => {
  const [links, setLinks] = useState({ outgoingLinks: [], backlinks: [] });
  const [suggestions, setSuggestions] = useState([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [explanation, setExplanation] = useState(null); // For manual explanation if needed

  useEffect(() => {
    if (selectedNote) {
      fetchLinks();
      setSuggestions([]); // Clear previous suggestions
    } else {
      setLinks({ outgoingLinks: [], backlinks: [] });
    }
  }, [selectedNote?.id]);

  const fetchLinks = async () => {
    if (!selectedNote?.id) return;
    try {
      setLoadingLinks(true);
      const res = await api.get(`/notes/${selectedNote.id}/links`);
      setLinks(res.data);
    } catch (err) {
      console.error("Failed to fetch links", err);
    } finally {
      setLoadingLinks(false);
    }
  };

  const handleSuggest = async () => {
    if (!selectedNote?.id) return;
    try {
      setAnalyzing(true);
      const res = await axios.post(`/notes/${selectedNote.id}/suggest-links`);
      setSuggestions(res.data);
    } catch (err) {
      console.error("AI Suggestion failed", err);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAcceptLink = async (suggestion) => {
    try {
      await api.post("/links", {
        from: selectedNote.id,
        to: suggestion.toId,
        reason: suggestion.reason,
      });
      // Refresh links
      fetchLinks();
      // Remove from suggestions
      setSuggestions((prev) => prev.filter((s) => s.toId !== suggestion.toId));
    } catch (err) {
      console.error("Failed to link", err);
    }
  };

  // Helper to resolve title (assuming we might need to fetch note titles if not provided)
  // For now, assuming API returns lightweight structure or we need to look it up.
  // The current storage.js getNoteLinks returns { to, reason ... } but 'to' is just ID.
  // Ideally, storage.js should populate titles.
  // Let's assume we need to fetch titles or the backend is updated.
  // Checking storage.js: getNoteLinks just returns IDs. This is a gap.
  // I will add a small inline fetch for titles or update backend.
  // For robustness, I'll assume we need to fetch note details for ID.
  // Optimization: In a real app, `getNoteLinks` should populate.
  // I will display ID for now or try to match if I had allNotes passed down.
  // Actually, let's use a "NoteLinkItem" component that fetches its own title if missing?
  // Or better, assume we can pass `allNotes` or the backend populates it.
  // I'll update the display to generic "Note" if title missing, but ideally we fix backend.

  // WAIT: I can just update the frontend to do a quick lookup if I had a cache.
  // But strictly I should ask Backend to populate.
  // Let's assume for this step I'll display the ID or a placeholder,
  // AND I'll ask to update backend in next step for better UX.

  // Correction: `NoteView` had `allNotes` available or fetched them.
  // `Sidebar` fetches all notes. `App` doesn't pass allNotes to Layout.
  // I will assume for now we might see IDs or I should update backend.
  // Let's stick to UI structure first.

  return (
    <div className="context-panel">
      <div className="context-panel-header">
        <div className="context-panel-title">Context</div>
        <button className="context-panel-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="context-panel-content">
        {!selectedNote ? (
          <div className="context-panel-empty">
            <div className="context-panel-empty-text">
              Select a note to view connections
            </div>
          </div>
        ) : (
          <div className="context-section-container">
            <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
              {selectedNote.title}
            </h3>

            {/* ACTIONS */}
            <div style={{ marginBottom: "1.5rem" }}>
              <button
                onClick={handleSuggest}
                className="ai-suggest-btn"
                disabled={analyzing}
              >
                <Sparkles size={14} />
                {analyzing ? "Analyzing..." : "Suggest Connections"}
              </button>
            </div>

            {/* AI SUGGESTIONS */}
            {suggestions.length > 0 && (
              <div className="context-section">
                <div className="section-title">
                  <Sparkles size={12} /> AI Suggestions
                </div>
                <div className="links-list">
                  {suggestions.map((param) => (
                    <div key={param.toId} className="suggestion-card">
                      <div className="suggestion-reason">{param.reason}</div>
                      <div className="suggestion-actions">
                        <span className="confidence-badge">
                          {(param.confidence * 100).toFixed(0)}%
                        </span>
                        <button onClick={() => handleAcceptLink(param)}>
                          Link
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* BACKLINKS */}
            <div className="context-section">
              <div className="section-title">referenced by</div>
              {loadingLinks ? (
                <div>Loading...</div>
              ) : (
                <div className="links-list">
                  {links.backlinks.length === 0 && (
                    <div className="empty-links">No backlinks</div>
                  )}
                  {links.backlinks.map((l, i) => (
                    <div key={i} className="link-item">
                      <ArrowLeft size={12} />
                      <span>{l.from}</span> {/* TODO: Resolve Title */}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* OUTGOING */}
            <div className="context-section">
              <div className="section-title">mentions</div>
              {loadingLinks ? (
                <div>Loading...</div>
              ) : (
                <div className="links-list">
                  {links.outgoingLinks.length === 0 && (
                    <div className="empty-links">No outgoing links</div>
                  )}
                  {links.outgoingLinks.map((l, i) => (
                    <div key={i} className="link-item">
                      <ArrowRight size={12} />
                      <span>{l.to}</span> {/* TODO: Resolve Title */}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContextPanel;
