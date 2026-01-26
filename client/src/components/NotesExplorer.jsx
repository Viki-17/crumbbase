import React, { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  Folder,
  FolderOpen,
  FolderPlus,
  ArrowLeft,
  Grid,
  Layers,
  Search,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import NoteCard from "./NoteCard";

const NotesExplorer = ({ onSelectView, initialState }) => {
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);

  // View State: 'all' | 'folders' | 'ask'
  // If initialState is provided, restore it, otherwise default to 'all'
  const [viewMode, setViewMode] = useState(initialState?.viewMode || "all");

  // For 'folders' view - specific accordion state
  const [expandedFolders, setExpandedFolders] = useState(
    initialState?.expandedFolders || [],
  );

  // Pagination state
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalNotes, setTotalNotes] = useState(0);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [searchQuery, setSearchQuery] = useState(
    initialState?.searchQuery || "",
  );
  const [askQuery, setAskQuery] = useState(initialState?.askQuery || "");
  const [askResults, setAskResults] = useState(initialState?.askResults || []);
  const [isAsking, setIsAsking] = useState(false);

  const [selectedNotes, setSelectedNotes] = useState([]);
  const [explanation, setExplanation] = useState(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [organizationProgress, setOrganizationProgress] = useState(null); // { current, total }
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

  const handleAsk = async (e) => {
    e.preventDefault();
    if (!askQuery.trim()) return;

    setIsAsking(true);
    try {
      const res = await api.post("/notes/ask", { query: askQuery });
      setAskResults(res.data);
    } catch (err) {
      toast.error("Failed to ask AI: " + err.message);
    } finally {
      setIsAsking(false);
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
      setOrganizationProgress(null);
      toast("AI is organizing your notes...");

      // Subscribe to SSE for folder events
      const eventSource = new EventSource("/api/folders/events");

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "foldersProgress") {
            // Progressive update - show partial results
            setFolders(data.folders || []);
            setOrganizationProgress({
              current: data.current,
              total: data.total,
            });
            toast(`Processing batch ${data.current}/${data.total}...`);
          } else if (data.type === "foldersDone") {
            setFolders(data.folders || []);
            setViewMode("folders");
            toast.success(data.message || "Organization complete!");
            setIsOrganizing(false);
            setOrganizationProgress(null);
            eventSource.close();
          } else if (data.type === "foldersError") {
            toast.error("Organization failed: " + data.error);
            setIsOrganizing(false);
            setOrganizationProgress(null);
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
      setOrganizationProgress(null);
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

  const handleDirectLink = async () => {
    if (selectedNotes.length !== 2) return;
    setIsLinking(true);
    try {
      await api.post("/links", {
        from: selectedNotes[0],
        to: selectedNotes[1],
        reason: "Manual link created by user",
      });
      fetchGraph();
      setSelectedNotes([]);
      setExplanation(null);
      toast.success("Link created!");
    } catch (err) {
      toast.error("Failed: " + err.message);
    }
    setIsLinking(false);
  };

  const getLinkedNoteIds = (noteId) => {
    return graph.edges
      .filter((e) => e.from === noteId || e.to === noteId)
      .map((e) => (e.from === noteId ? e.to : e.from));
  };

  const toggleFolder = (folderId) => {
    setExpandedFolders((prev) =>
      prev.includes(folderId)
        ? prev.filter((id) => id !== folderId)
        : [...prev, folderId],
    );
  };

  // Helper to trigger navigation with current state
  const selectNote = (noteId) => {
    const currentState = {
      viewMode,
      expandedFolders,
      notes, // Keep notes so we don't have to refetch or lose scrolling? (though App refetches)
      askQuery,
      askResults,
      searchQuery,
    };
    onSelectView("note", noteId, currentState);
  };

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
                : viewMode === "ask"
                  ? "Ask AI"
                  : `All Atomic Notes (${notes.length} of ${totalNotes})`}
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {/* View Toggles */}

            {viewMode === "ask" && (
              <button
                onClick={() => {
                  setViewMode("all");
                  setAskResults([]);
                  setAskQuery("");
                }}
                className="btn-ghost"
              >
                <ArrowLeft size={16} /> Back to All
              </button>
            )}

            <button
              onClick={() => setViewMode("all")}
              className={viewMode === "all" ? "btn-primary" : "btn-ghost"}
            >
              <Grid size={16} /> All
            </button>
            <button
              onClick={() => setViewMode("folders")}
              className={viewMode === "folders" ? "btn-primary" : "btn-ghost"}
            >
              <Layers size={16} /> Folders
            </button>

            <button
              onClick={handleAutoOrganize}
              disabled={isOrganizing}
              className="btn-secondary"
            >
              <FolderPlus size={16} />{" "}
              {isOrganizing
                ? organizationProgress
                  ? `Processing ${organizationProgress.current}/${organizationProgress.total}...`
                  : "Organizing..."
                : "Auto Organize"}
            </button>

            <button
              onClick={() => setViewMode("ask")}
              className={viewMode === "ask" ? "btn-primary" : "btn-ghost"}
              style={
                viewMode === "ask"
                  ? {
                      background: "var(--accent-color)",
                      borderColor: "transparent",
                    }
                  : {}
              }
            >
              <Sparkles size={16} /> Ask AI
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
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={handleExplainLink}
                disabled={isExplaining}
                style={{ background: "white", color: "#000" }}
              >
                {isExplaining ? "Analyzing..." : "🤖 AI Explain"}
              </button>
              <button
                onClick={handleDirectLink}
                disabled={isLinking}
                style={{ background: "#10b981", color: "white" }}
              >
                {isLinking ? "Linking..." : "🔗 Link Directly"}
              </button>
            </div>
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
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {folders.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "2rem",
                opacity: 0.6,
              }}
            >
              No folders yet. Click 'Auto Organize' to group your notes.
            </div>
          )}
          {folders.map((folder, i) => {
            const isExpanded = expandedFolders.includes(folder.id || i); // fallback to index if id missing, but backend should provide id
            const folderId = folder.id || i; // Assuming folder object has id, else using index logic which might be flaky if list changes

            // Get notes for this folder
            const folderNotes = notes.filter((n) =>
              folder.noteIds?.includes(n.id),
            );

            return (
              <div key={folderId} className="card" style={{ padding: "0" }}>
                <div
                  onClick={() => toggleFolder(folderId)}
                  className="folder-header"
                  style={{
                    padding: "1.5rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: isExpanded
                      ? "var(--bg-surface-2)"
                      : "transparent",
                    transition: "var(--transition)",
                    borderBottom: isExpanded
                      ? "1px solid var(--border-color)"
                      : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                    }}
                  >
                    {isExpanded ? (
                      <FolderOpen className="text-primary" size={24} />
                    ) : (
                      <Folder className="text-secondary" size={24} />
                    )}
                    <div>
                      <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
                        {folder.name}
                      </h3>
                      <p
                        className="text-secondary"
                        style={{ margin: 0, fontSize: "0.85rem" }}
                      >
                        {folder.noteIds?.length || 0} items
                      </p>
                    </div>
                  </div>
                  <div style={{ opacity: 0.6 }}>
                    {isExpanded ? (
                      <ChevronDown size={20} />
                    ) : (
                      <ChevronRight size={20} />
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div
                    style={{
                      padding: "1.5rem",
                      borderTop: "1px solid var(--border-color)",
                      background: "var(--bg-surface-1)",
                    }}
                  >
                    {folderNotes.length === 0 ? (
                      <p className="text-secondary">
                        Loading notes or empty folder...
                      </p>
                    ) : (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fill, minmax(300px, 1fr))",
                          gap: "1rem",
                        }}
                      >
                        {folderNotes.map((note) => {
                          const isSelected = selectedNotes.includes(note.id);
                          const linkedIds = getLinkedNoteIds(note.id);
                          return (
                            <NoteCard
                              key={note.id}
                              note={note}
                              isSelected={isSelected}
                              onSelect={() => {
                                // If selecting for link, toggle select
                                // If just clicking, maybe we want to navigate?
                                // Current behavior in 'all' view is generic select.
                                // But user wants "click on notes its going to full note page"
                                // NoteCard usually handles onSelect for selection, but we want navigation?
                                // In NoteCard, the whole card has onClick={onSelect}.
                                // In 'all' view logic: onSelect={() => toggleSelect(note.id)}
                                // So it just selects.
                                // To navigate, we need a separate interaction or change NoteCard behavior.
                                // Wait, the user said "when we click on the notes its going to the full note page".
                                // So I should probably make the card clickable for navigation, and add a specific 'select' interaction?
                                // OR, just adhere to current App behavior where NoteCard in 'All' view toggles select.
                                // BUT, NoteCard in GraphView navigates.
                                // Let's implement navigation on click for the card text/header, and selection on a checkbox or specific area?
                                // OR: Just keep selection logic, but add a Button "Open" inside NoteCard?
                                // Actually, the user's request implies they *are* navigating.
                                // Let's assume they added navigation logic or expect it.
                                // I will add an "Open" button or make the title clickable for navigation.
                                // Let's make the Title clickable for navigation.
                                selectNote(note.id);
                              }}
                              onUpdate={handleUpdateNote}
                              onDeleteNote={handleDeleteNote}
                              linkedCount={linkedIds.length}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : viewMode === "ask" ? (
        <>
          <form
            onSubmit={handleAsk}
            className="input-group"
            style={{ marginBottom: "1.5rem" }}
          >
            <input
              type="text"
              placeholder="Ask a question about your notes..."
              value={askQuery}
              onChange={(e) => setAskQuery(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="submit"
              disabled={isAsking}
              className="btn-primary"
              style={{ background: "var(--accent-color)" }}
            >
              <Sparkles size={16} /> {isAsking ? "Thinking..." : "Ask"}
            </button>
          </form>

          {askResults.length === 0 && !isAsking && askQuery && (
            <div
              style={{
                textAlign: "center",
                padding: "2rem",
                opacity: 0.6,
              }}
            >
              No relevant notes found. Try a different question.
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "1rem",
            }}
          >
            {askResults.map((note) => {
              const isSelected = selectedNotes.includes(note.id);
              const linkedIds = getLinkedNoteIds(note.id);
              return (
                <div key={note.id} style={{ position: "relative" }}>
                  {note.score && (
                    <div
                      style={{
                        position: "absolute",
                        top: "-10px",
                        right: "10px",
                        background: "var(--accent-color)",
                        fontSize: "0.7rem",
                        padding: "2px 8px",
                        borderRadius: "12px",
                        zIndex: 10,
                      }}
                    >
                      Match: {Math.round(note.score * 100)}%
                    </div>
                  )}
                  <NoteCard
                    note={note}
                    isSelected={isSelected}
                    onSelect={() => selectNote(note.id)}
                    onUpdate={handleUpdateNote}
                    onDeleteNote={handleDeleteNote}
                    linkedCount={linkedIds.length}
                  />
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {/* Search Bar for Notes (only in 'all' view) */}
          {viewMode === "all" && (
            <form
              onSubmit={handleSearch}
              className="input-group"
              style={{ marginBottom: "1.5rem" }}
            >
              <input
                type="text"
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="submit"
                disabled={isLoadingNotes}
                className="btn-secondary"
              >
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
            {notes.length === 0 && !isLoadingNotes && (
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
            {notes.map((note) => {
              const isSelected = selectedNotes.includes(note.id);
              const linkedIds = getLinkedNoteIds(note.id);
              return (
                <NoteCard
                  key={note.id}
                  note={note}
                  isSelected={isSelected}
                  onSelect={() => selectNote(note.id)}
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
                className="btn-primary"
                style={{ minWidth: "200px" }}
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
