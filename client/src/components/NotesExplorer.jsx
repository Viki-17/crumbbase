import React, { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { Folder, FolderPlus, ArrowLeft, Grid, Layers } from "lucide-react";
import NoteCard from "./NoteCard";

const NotesExplorer = () => {
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  // View State: 'all' | 'folders' | 'folder-detail'
  const [viewMode, setViewMode] = useState("all");
  const [activeFolder, setActiveFolder] = useState(null);

  const [selectedNotes, setSelectedNotes] = useState([]);
  const [explanation, setExplanation] = useState(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [graph, setGraph] = useState({ nodes: {}, edges: [] });

  useEffect(() => {
    fetchNotes();
    fetchGraph();
    fetchFolders();
  }, []);

  const fetchNotes = async () => {
    const res = await axios.get("/api/notes");
    setNotes(res.data);
  };

  const fetchFolders = async () => {
    try {
      const res = await axios.get("/api/folders");
      setFolders(res.data.folders || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchGraph = async () => {
    const res = await axios.get("/api/graph");
    setGraph(res.data);
  };

  const handleAutoOrganize = async () => {
    try {
      setIsOrganizing(true);
      toast("AI is organizing your notes...");
      const res = await axios.post("/api/folders/generate");
      setFolders(res.data.folders || []);
      setViewMode("folders");
      toast.success("Organization complete!");
    } catch (err) {
      toast.error("Organization failed: " + err.message);
    } finally {
      setIsOrganizing(false);
    }
  };

  const handleUpdateNote = (updatedNote) => {
    setNotes(notes.map((n) => (n.id === updatedNote.id ? updatedNote : n)));
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await axios.delete(`/api/notes/${noteId}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success("Note deleted");
    } catch (err) {
      toast.error("Failed to delete note: " + err.message);
    }
  };

  const toggleSelect = (noteId) => {
    setSelectedNotes((prev) => {
      if (prev.includes(noteId)) {
        return prev.filter((id) => id !== noteId);
      } else if (prev.length < 2) {
        return [...prev, noteId];
      }
      return [prev[1], noteId];
    });
    setExplanation(null);
  };

  const handleExplainLink = async () => {
    if (selectedNotes.length !== 2) return;
    setIsExplaining(true);
    setExplanation(null);
    try {
      const res = await axios.post("/api/links/explain", {
        noteIdA: selectedNotes[0],
        noteIdB: selectedNotes[1],
      });
      setExplanation(res.data.explanation);
    } catch (err) {
      setExplanation("Failed to get explanation: " + err.message);
    }
    setIsExplaining(false);
  };

  const handleConfirmLink = async () => {
    if (selectedNotes.length !== 2 || !explanation) return;
    setIsLinking(true);
    try {
      await axios.post("/api/links", {
        from: selectedNotes[0],
        to: selectedNotes[1],
        reason: explanation,
      });
      fetchGraph();
      setSelectedNotes([]);
      setExplanation(null);
    } catch (err) {
      alert("Failed: " + err.message);
    }
    setIsLinking(false);
  };

  const handleRejectLink = () => {
    setExplanation(null);
  };

  const getLinkedNoteIds = (noteId) => {
    return graph.edges
      .filter((e) => e.from === noteId || e.to === noteId)
      .map((e) => (e.from === noteId ? e.to : e.from));
  };

  // Filter Logic
  const filteredNotes =
    viewMode === "folder-detail" && activeFolder
      ? notes.filter((n) => activeFolder.noteIds.includes(n.id))
      : notes;

  return (
    <div className="container">
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2>🧠 Notes Explorer</h2>
            <p className="text-secondary">
              {viewMode === "folders"
                ? "AI Organized Folders"
                : viewMode === "folder-detail"
                ? `Folder: ${activeFolder?.name}`
                : "All Atomic Notes"}
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {/* View Toggles */}
            {viewMode === "folder-detail" && (
              <button
                onClick={() => {
                  setViewMode("folders");
                  setActiveFolder(null);
                }}
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--border-color)",
                  color: "var(--text-primary)",
                }}
              >
                <ArrowLeft size={16} /> Back
              </button>
            )}

            <button
              onClick={() => setViewMode("all")}
              style={{
                background:
                  viewMode === "all" ? "var(--primary-color)" : "transparent",
                border:
                  viewMode === "all" ? "none" : "1px solid var(--border-color)",
              }}
            >
              <Grid size={16} /> All
            </button>
            <button
              onClick={() => setViewMode("folders")}
              style={{
                background: viewMode.startsWith("folder")
                  ? "var(--primary-color)"
                  : "transparent",
                border: viewMode.startsWith("folder")
                  ? "none"
                  : "1px solid var(--border-color)",
              }}
            >
              <Layers size={16} /> Folders
            </button>

            <button
              onClick={handleAutoOrganize}
              disabled={isOrganizing}
              style={{ background: "var(--accent-color)" }}
            >
              <FolderPlus size={16} />{" "}
              {isOrganizing ? "Organizing..." : "Auto Organize"}
            </button>
          </div>
        </div>
      </div>

      {/* Selection Bar */}
      {selectedNotes.length === 2 && (
        <div
          className="card"
          style={{ background: "var(--primary-color)", marginBottom: "1rem" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              <strong>Selected:</strong>{" "}
              {notes.find((n) => n.id === selectedNotes[0])?.title} ↔{" "}
              {notes.find((n) => n.id === selectedNotes[1])?.title}
            </span>
            <button
              onClick={handleExplainLink}
              disabled={isExplaining}
              style={{ background: "white", color: "#000" }}
            >
              {isExplaining ? "Analyzing..." : "Explain Relationship"}
            </button>
          </div>
          {explanation && (
            <div
              style={{
                marginTop: "1rem",
                padding: "1rem",
                background: "rgba(255,255,255,0.1)",
                borderRadius: "8px",
              }}
            >
              <p style={{ marginBottom: "1rem" }}>{explanation}</p>
              <div style={{ display: "flex", gap: "1rem" }}>
                <button
                  onClick={handleConfirmLink}
                  disabled={isLinking}
                  style={{ background: "#22c55e" }}
                >
                  {isLinking ? "Saving..." : "✓ Confirm Link"}
                </button>
                <button
                  onClick={handleRejectLink}
                  style={{ background: "#ef4444" }}
                >
                  ✗ Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CONTENT AREA */}

      {viewMode === "folders" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "1rem",
          }}
        >
          {folders.length === 0 && (
            <div
              style={{
                gridColumn: "1/-1",
                textAlign: "center",
                padding: "2rem",
                opacity: 0.6,
              }}
            >
              No folders yet. Click 'Auto Organize' to group your notes.
            </div>
          )}
          {folders.map((folder, i) => (
            <div
              key={i}
              className="card"
              style={{
                cursor: "pointer",
                textAlign: "center",
                padding: "2rem",
                border: "1px solid var(--border-color)",
              }}
              onClick={() => {
                setActiveFolder(folder);
                setViewMode("folder-detail");
              }}
              onMouseOver={(e) =>
                (e.currentTarget.style.borderColor = "var(--primary-color)")
              }
              onMouseOut={(e) =>
                (e.currentTarget.style.borderColor = "var(--border-color)")
              }
            >
              <Folder
                size={48}
                style={{ color: "var(--primary-color)", marginBottom: "1rem" }}
              />
              <h3>{folder.name}</h3>
              <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                {folder.noteIds?.length || 0} items
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "1rem",
          }}
        >
          {filteredNotes.length === 0 && (
            <div
              style={{
                gridColumn: "1/-1",
                textAlign: "center",
                padding: "2rem",
                opacity: 0.6,
              }}
            >
              No notes found.
            </div>
          )}
          {filteredNotes.map((note) => {
            const isSelected = selectedNotes.includes(note.id);
            const linkedIds = getLinkedNoteIds(note.id);
            return (
              <NoteCard
                key={note.id}
                note={note}
                isSelected={isSelected}
                onSelect={() => toggleSelect(note.id)}
                onUpdate={handleUpdateNote}
                onDeleteNote={handleDeleteNote}
                linkedCount={linkedIds.length}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default NotesExplorer;
