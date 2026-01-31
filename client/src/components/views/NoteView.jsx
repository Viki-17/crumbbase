import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import api from "../../api";
import { Edit2, Save, X, Sparkles, FileText, ArrowLeft } from "lucide-react";
import Loading from "../layout/Loading";
import "./../../styles/note-view.css";

/**
 * NoteView - Single note display with inline editing
 *
 * Features:
 * - Display mode: Markdown rendering
 * - Edit mode: Inline editing for title, content, tags
 * - Actions: Edit, Save, Suggest Links
 * - Source book/chapter link
 */
const NoteView = ({ noteId, onNoteUpdated, onBack }) => {
  const [note, setNote] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedContent, setEditedContent] = useState("");
  const [editedTags, setEditedTags] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // State for suggestions
  const [suggestions, setSuggestions] = useState([]);
  const [suggesting, setSuggesting] = useState(false);

  const [sourceBook, setSourceBook] = useState(null);
  const [sourceChapter, setSourceChapter] = useState(null);

  React.useEffect(() => {
    if (noteId) {
      fetchNote();
      setSuggestions([]); // Clear suggestions on note change
      setSourceBook(null); // Reset source info
      setSourceChapter(null);
    }
  }, [noteId]);

  const fetchNote = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/notes/${noteId}`);
      if (res.data) {
        setNote(res.data);
        setEditedTitle(res.data.title);
        setEditedContent(res.data.content);
        setEditedTags(res.data.tags?.join(", ") || "");

        // Fetch source details if available
        if (res.data.source?.bookId) {
          fetchSourceDetails(res.data.source.bookId, res.data.source.chapterId);
        }
      }
    } catch (err) {
      console.error("Failed to fetch note:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSourceDetails = async (bookId, chapterId) => {
    try {
      console.log(`Fetching book details for: ${bookId}`);
      const res = await api.get(`/books/${bookId}`);
      console.log("Book details response:", res.data);
      if (res.data) {
        setSourceBook(res.data);
        if (chapterId && res.data.chapters) {
          // The book endpoints returns hydrated chapters now?
          // /books/:id returns object with chapters array of objects (if hydrated) or IDs?
          // Checking server: /books/:id returns chapters: [{...}, ...] (hydrated)
          const foundChap = res.data.chapters.find((c) => c.id === chapterId);
          console.log("Found chapter:", foundChap);
          setSourceChapter(foundChap);
        }
      }
    } catch (err) {
      console.error("Failed to fetch source book", err);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const tagsArray = editedTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await api.patch(`/notes/${noteId}`, {
        title: editedTitle,
        content: editedContent,
        tags: tagsArray,
      });

      setNote(res.data);
      setIsEditing(false);
      if (onNoteUpdated) onNoteUpdated(res.data);
    } catch (err) {
      alert("Failed to save note: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedTitle(note.title);
    setEditedContent(note.content);
    setEditedTags(note.tags?.join(", ") || "");
    setIsEditing(false);
  };

  const handleSuggestLinks = async () => {
    try {
      setSuggesting(true);
      const res = await api.post(`/notes/${noteId}/suggest-links`);
      // API returns array of { toId, reason, confidence }
      // We need to fetch the titles for 'toId' to display nicely?
      // Or maybe the API should return titles too.
      // For now let's hope vector-store returns lightweight objects or we just show reason.
      // Wait, client doesn't know titles for toId unless we look up from allNotes context or fetch them.
      // Let's assume we can find them from a cache or the API returns title.
      // Checking vector-store.js, it returns: { toId, reason, confidence }
      // We can look up titles from a context provider if available, or just fetch all notes lite.
      // For this view, we might need to fetch all notes to resolve names if not passed.
      // Let's do a quick lookup fetch since we don't have allNotes prop here.

      const allNotesRes = await api.get("/notes"); // Optimizable
      const allNotes = allNotesRes.data;

      const enhancedSuggestions = res.data.map((s) => {
        const target = allNotes.find((n) => n.id === s.toId);
        return { ...s, targetTitle: target?.title || "Unknown Note" };
      });

      setSuggestions(enhancedSuggestions);

      if (enhancedSuggestions.length === 0) {
        alert("No strong conceptual links found.");
      }
    } catch (err) {
      console.error("Failed to get suggestions:", err);
      alert("Failed to get link suggestions: " + err.message);
    } finally {
      setSuggesting(false);
    }
  };

  const handleAcceptLink = async (suggestion) => {
    try {
      await api.post("/links", {
        from: noteId,
        to: suggestion.toId,
        reason: suggestion.reason,
      });
      // Remove from list
      setSuggestions((prev) => prev.filter((s) => s.toId !== suggestion.toId));
      // Trigger global graph update if possible, or just notify user
      // onNoteUpdated callback might not be enough for graph view reload
      // But usually GraphView filters based on backend data on mount/refresh.
    } catch (err) {
      alert("Failed to link: " + err.message);
    }
  };

  if (loading) {
    return (
      <div className="note-view">
        <Loading message="Loading note..." />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="note-view-empty">
        <div className="note-view-empty-icon">
          <FileText size={64} />
        </div>
        <p>Note not found</p>
      </div>
    );
  }

  return (
    <div className="note-view container">
      <div style={{ marginBottom: "1rem" }}>
        <button
          onClick={onBack}
          className="btn-ghost"
          style={{ paddingLeft: 0 }}
        >
          <ArrowLeft size={20} /> Back
        </button>
      </div>
      <div className="note-view-header">
        <div className="note-view-title-section">
          {isEditing ? (
            <input
              type="text"
              className="note-view-title"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              placeholder="Note title"
              autoFocus
            />
          ) : (
            <h1 className="note-view-title">{note.title}</h1>
          )}

          <div className="note-view-meta">
            {note.source?.bookId && (
              <span>
                From:{" "}
                <span className="note-view-source-link">
                  From:{" "}
                  <span className="note-view-source-link">
                    {sourceBook ? sourceBook.title : "Unknown Book"} /{" "}
                    {sourceChapter
                      ? sourceChapter.title ||
                        `Ch. ${sourceChapter.chapterIndex}`
                      : "Unknown Chapter"}
                  </span>
                </span>
              </span>
            )}
            <span>·</span>
            <span>{new Date(note.createdAt).toLocaleDateString()}</span>
          </div>
        </div>

        <div className="note-view-actions">
          {isEditing ? (
            <>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                <Save size={16} />
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                className="btn-ghost"
                onClick={handleCancel}
                disabled={saving}
              >
                <X size={16} />
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn-ghost" onClick={() => setIsEditing(true)}>
                <Edit2 size={16} />
                Edit
              </button>
              <button
                className="btn-ghost"
                onClick={handleSuggestLinks}
                disabled={suggesting}
              >
                <Sparkles size={16} />
                {suggesting ? "Analyzing..." : "Suggest Links"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Suggestions Panel */}
      {suggestions.length > 0 && (
        <div
          className="suggestions-panel"
          style={{
            marginBottom: "1rem",
            padding: "1rem",
            background: "rgba(99, 102, 241, 0.1)",
            borderRadius: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.5rem",
            }}
          >
            <h4
              style={{
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <Sparkles size={14} /> AI Suggestions ({suggestions.length})
            </h4>
            <button
              onClick={() => setSuggestions([])}
              style={{
                background: "none",
                border: "none",
                opacity: 0.5,
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {suggestions.map((s) => (
              <div
                key={s.toId}
                style={{
                  background: "var(--card-bg)",
                  padding: "0.8rem",
                  borderRadius: "6px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                    ↔ {s.targetTitle}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      opacity: 0.8,
                      marginTop: "2px",
                    }}
                  >
                    {s.reason}
                  </div>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      marginTop: "4px",
                      opacity: 0.6,
                    }}
                  >
                    Confidence: {(s.confidence * 100).toFixed(0)}%
                  </div>
                </div>
                <button
                  onClick={() => handleAcceptLink(s)}
                  style={{
                    background: "#10b981",
                    color: "white",
                    border: "none",
                    padding: "4px 10px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                  }}
                >
                  Link
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="note-view-tags">
        {isEditing ? (
          <input
            type="text"
            value={editedTags}
            onChange={(e) => setEditedTags(e.target.value)}
            placeholder="Tags (comma separated)"
          />
        ) : (
          note.tags?.map((tag) => (
            <span key={tag} className="note-view-tag">
              #{tag}
            </span>
          ))
        )}
      </div>

      <div className="note-view-content">
        {isEditing ? (
          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            placeholder="Note content (Markdown supported)"
          />
        ) : (
          <div className="note-view-markdown">
            <ReactMarkdown>{note.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};

export default NoteView;
