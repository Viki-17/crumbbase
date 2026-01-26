import React, { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  Folder,
  FolderPlus,
  ArrowLeft,
  Grid,
  Layers,
  Search,
  Loader2,
} from "lucide-react";
import NoteCard from "./NoteCard";

const NotesExplorer = () => {
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  // View State: 'all' | 'folders' | 'folder-detail'
  const [viewMode, setViewMode] = useState("all");
  const [activeFolder, setActiveFolder] = useState(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalNotes, setTotalNotes] = useState(0);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedNotes, setSelectedNotes] = useState([]);
  const [explanation, setExplanation] = useState(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [graph, setGraph] = useState({ nodes: {}, edges: [] });

  // New folder creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  useEffect(() => {
    fetchNotes(1, true);
    fetchGraph();
    fetchFolders();
  }, []);

  const fetchNotes = useCallback(
    async (pageNum = 1, reset = false) => {
      try {
        setIsLoadingNotes(true);
        const res = await api.get("/notes", {
          params: { page: pageNum, limit: 20, search: searchQuery },
        });
        const { notes: fetchedNotes, pagination } = res.data;

        if (reset) {
          setNotes(fetchedNotes);
        } else {
          setNotes((prev) => [...prev, ...fetchedNotes]);
        }
        setPage(pagination.page);
        setHasMore(pagination.hasMore);
        setTotalNotes(pagination.total);
      } catch (err) {
        console.error(err);
        toast.error("Failed to load notes");
      } finally {
        setIsLoadingNotes(false);
      }
    },
    [searchQuery],
  );

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchNotes(1, true);
  };

  const loadMoreNotes = () => {
    if (hasMore && !isLoadingNotes) {
      fetchNotes(page + 1, false);
    }
  };

  const fetchFolders = async () => {
    try {
      const res = await api.get("/folders");
      setFolders(res.data.folders || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchGraph = async () => {
    const res = await api.get("/graph");
    setGraph(res.data);
  };

  const handleAutoOrganize = async () => {
    try {
      setIsOrganizing(true);
      toast("AI is organizing your notes...");

      // Subscribe to SSE for folder events
      const eventSource = new EventSource("/api/folders/events");

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "foldersDone") {
            setFolders(data.folders || []);
            setViewMode("folders");
            toast.success(data.message || "Organization complete!");
            setIsOrganizing(false);
            eventSource.close();
          } else if (data.type === "foldersError") {
            toast.error("Organization failed: " + data.error);
            setIsOrganizing(false);
            eventSource.close();
          } else if (data.type === "foldersProcessing") {
            toast(data.message || "Processing...");
          }
        } catch (e) {
          console.error("Error parsing SSE event:", e);
        }
      };

      eventSource.onerror = () => {
        // Don't show error toast on close, it might just be the connection closing
        eventSource.close();
      };

      // Start the async job
      await api.post("/folders/generate");
    } catch (err) {
      toast.error("Organization failed: " + err.message);
      setIsOrganizing(false);
    }
  };

  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      setIsCreatingFolder(true);
      const res = await api.post("/folders", { name: newFolderName.trim() });
      setFolders(res.data.folders || []);
      setNewFolderName("");
      toast.success("Folder created!");
    } catch (err) {
      toast.error("Failed to create folder: " + err.message);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleUpdateNote = (updatedNote) => {
    setNotes(notes.map((n) => (n.id === updatedNote.id ? updatedNote : n)));
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await api.delete(`/notes/${noteId}`);
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
      const res = await api.post("/links/explain", {
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
      await api.post("/links", {
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
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <div>
            <h2>🧠 Notes Explorer</h2>
            <p className="text-secondary">
              {viewMode === "folders"
                ? "AI Organized Folders"
                : viewMode === "folder-detail"
                  ? `Folder: ${activeFolder?.name}`
                  : `All Atomic Notes (${notes.length} of ${totalNotes})`}
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
        <>
          {/* Search Bar for Notes (only in 'all' view) */}
          {viewMode === "all" && (
            <form
              onSubmit={handleSearch}
              style={{
                display: "flex",
                gap: "0.5rem",
                marginBottom: "1rem",
              }}
            >
              <input
                type="text"
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  padding: "0.75rem 1rem",
                  borderRadius: "8px",
                  border: "1px solid var(--border-color)",
                  background: "var(--card-bg)",
                  color: "var(--text-primary)",
                }}
              />
              <button type="submit" disabled={isLoadingNotes}>
                <Search size={16} /> Search
              </button>
            </form>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "1rem",
            }}
          >
            {filteredNotes.length === 0 && !isLoadingNotes && (
              <div
                style={{
                  gridColumn: "1/-1",
                  textAlign: "center",
                  padding: "2rem",
                  opacity: 0.6,
                }}
              >
                {searchQuery
                  ? "No notes match your search."
                  : "No notes found."}
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

          {/* Load More Button */}
          {viewMode === "all" && hasMore && (
            <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
              <button
                onClick={loadMoreNotes}
                disabled={isLoadingNotes}
                style={{
                  background: "var(--primary-color)",
                  minWidth: "200px",
                }}
              >
                {isLoadingNotes ? (
                  <>
                    <Loader2 size={16} className="spin" /> Loading...
                  </>
                ) : (
                  `Load More (${totalNotes - notes.length} remaining)`
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default NotesExplorer;
