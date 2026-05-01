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
  Brain,
  Link,
} from "lucide-react";
import NoteCard from "./NoteCard";

const NotesExplorer = ({ onSelectView, initialState }) => {
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [viewMode, setViewMode] = useState(initialState?.viewMode || "all");
  const [expandedFolders, setExpandedFolders] = useState(
    initialState?.expandedFolders || [],
  );
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
  const [organizationProgress, setOrganizationProgress] = useState(null);
  const [graph, setGraph] = useState({ nodes: {}, edges: [] });
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
      const eventSource = new EventSource("/api/folders/events");
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "foldersProgress") {
            setFolders(data.folders || []);
            setOrganizationProgress({ current: data.current, total: data.total });
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
      eventSource.onerror = () => { eventSource.close(); };
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
      if (prev.includes(noteId)) return prev.filter((id) => id !== noteId);
      else if (prev.length < 2) return [...prev, noteId];
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

  const handleRejectLink = () => { setExplanation(null); };

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
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId],
    );
  };

  const selectNote = (noteId) => {
    const currentState = {
      viewMode, expandedFolders, notes, askQuery, askResults, searchQuery,
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
            gap: "0.75rem",
          }}
        >
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "var(--font-size-lg)" }}>
              <Brain size={18} style={{ color: "var(--primary)" }} /> Notes Explorer
            </h2>
            <p className="text-secondary" style={{ fontSize: "var(--font-size-xs)", marginTop: "0.25rem" }}>
              {viewMode === "folders"
                ? "AI Organized Folders"
                : viewMode === "ask"
                  ? "Ask AI"
                  : `All Atomic Notes (${notes.length} of ${totalNotes})`}
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {viewMode === "ask" && (
              <button
                onClick={() => { setViewMode("all"); setAskResults([]); setAskQuery(""); }}
                className="btn-ghost"
              >
                <ArrowLeft size={14} /> Back
              </button>
            )}
            <button
              onClick={() => setViewMode("all")}
              className={viewMode === "all" ? "btn-primary" : "btn-ghost"}
            >
              <Grid size={14} /> All
            </button>
            <button
              onClick={() => setViewMode("folders")}
              className={viewMode === "folders" ? "btn-primary" : "btn-ghost"}
            >
              <Layers size={14} /> Folders
            </button>
            <button
              onClick={handleAutoOrganize}
              disabled={isOrganizing}
              className="btn-secondary"
            >
              <FolderPlus size={14} />{" "}
              {isOrganizing
                ? organizationProgress
                  ? `${organizationProgress.current}/${organizationProgress.total}`
                  : "Organizing..."
                : "Auto Organize"}
            </button>
            <button
              onClick={() => setViewMode("ask")}
              className={viewMode === "ask" ? "btn-primary" : "btn-ghost"}
              style={
                viewMode === "ask"
                  ? { background: "var(--accent)", borderColor: "transparent" }
                  : {}
              }
            >
              <Sparkles size={14} /> Ask AI
            </button>
          </div>
        </div>
      </div>

      {/* Selection Bar */}
      {selectedNotes.length === 2 && (
        <div
          className="card"
          style={{ background: "var(--primary-light)", border: "1px solid rgba(139, 92, 246, 0.2)" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            <span style={{ fontSize: "var(--font-size-sm)" }}>
              <strong>Selected:</strong>{" "}
              {notes.find((n) => n.id === selectedNotes[0])?.title} ↔{" "}
              {notes.find((n) => n.id === selectedNotes[1])?.title}
            </span>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button
                onClick={handleExplainLink}
                disabled={isExplaining}
                className="btn-secondary"
              >
                <Sparkles size={12} />
                {isExplaining ? "Analyzing..." : "AI Explain"}
              </button>
              <button
                onClick={handleDirectLink}
                disabled={isLinking}
                className="btn-primary"
                style={{ background: "var(--success)" }}
              >
                <Link size={12} />
                {isLinking ? "Linking..." : "Link Directly"}
              </button>
            </div>
          </div>
          {explanation && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.04)",
                borderRadius: "var(--border-radius-sm)",
                border: "1px solid var(--border-color)",
              }}
            >
              <p style={{ marginBottom: "0.75rem", fontSize: "var(--font-size-sm)" }}>{explanation}</p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={handleConfirmLink}
                  disabled={isLinking}
                  className="btn-primary"
                  style={{ background: "var(--success)" }}
                >
                  {isLinking ? "Saving..." : "Confirm Link"}
                </button>
                <button
                  onClick={handleRejectLink}
                  className="btn-ghost"
                  style={{ color: "var(--error)" }}
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CONTENT AREA */}
      {viewMode === "folders" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {folders.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem", opacity: 0.5, fontSize: "var(--font-size-sm)" }}>
              No folders yet. Click &apos;Auto Organize&apos; to group your notes.
            </div>
          )}
          {folders.map((folder, i) => {
            const isExpanded = expandedFolders.includes(folder.id || i);
            const folderId = folder.id || i;
            const folderNotes = notes.filter((n) => folder.noteIds?.includes(n.id));
            return (
              <div key={folderId} className="card" style={{ padding: "0" }}>
                <div
                  onClick={() => toggleFolder(folderId)}
                  style={{
                    padding: "1rem 1.25rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: isExpanded ? "var(--bg-surface-2)" : "transparent",
                    transition: "var(--transition-fast)",
                    borderBottom: isExpanded ? "1px solid var(--border-color)" : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    {isExpanded ? (
                      <FolderOpen style={{ color: "var(--primary)" }} size={18} />
                    ) : (
                      <Folder style={{ color: "var(--text-tertiary)" }} size={18} />
                    )}
                    <div>
                      <h3 style={{ margin: 0, fontSize: "var(--font-size-base)", fontWeight: "500" }}>
                        {folder.name}
                      </h3>
                      <p className="text-secondary" style={{ margin: 0, fontSize: "var(--font-size-xs)" }}>
                        {folder.noteIds?.length || 0} items
                      </p>
                    </div>
                  </div>
                  <div style={{ opacity: 0.4 }}>
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ padding: "1rem", background: "rgba(0,0,0,0.1)" }}>
                    {folderNotes.length === 0 ? (
                      <p className="text-secondary" style={{ fontSize: "var(--font-size-sm)" }}>
                        Loading notes or empty folder...
                      </p>
                    ) : (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                          gap: "0.75rem",
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
                              onSelect={() => selectNote(note.id)}
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
          <form onSubmit={handleAsk} className="input-group" style={{ marginBottom: "1rem" }}>
            <input
              type="text"
              placeholder="Ask a question about your notes..."
              value={askQuery}
              onChange={(e) => setAskQuery(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={isAsking} className="btn-primary" style={{ background: "var(--accent)" }}>
              <Sparkles size={14} /> {isAsking ? "Thinking..." : "Ask"}
            </button>
          </form>
          {askResults.length === 0 && !isAsking && askQuery && (
            <div style={{ textAlign: "center", padding: "2rem", opacity: 0.5, fontSize: "var(--font-size-sm)" }}>
              No relevant notes found. Try a different question.
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "0.75rem",
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
                        position: "absolute", top: "-8px", right: "10px",
                        background: "var(--accent)", fontSize: "0.6rem", fontWeight: "600",
                        padding: "1px 7px", borderRadius: "var(--border-radius-pill)", zIndex: 10, color: "#fff",
                      }}
                    >
                      {Math.round(note.score * 100)}%
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
          {viewMode === "all" && (
            <form onSubmit={handleSearch} className="input-group" style={{ marginBottom: "1rem" }}>
              <input
                type="text"
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" disabled={isLoadingNotes} className="btn-secondary">
                <Search size={14} /> Search
              </button>
            </form>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "0.75rem",
            }}
          >
            {notes.length === 0 && !isLoadingNotes && (
              <div
                style={{ gridColumn: "1/-1", textAlign: "center", padding: "2rem", opacity: 0.5, fontSize: "var(--font-size-sm)" }}
              >
                {searchQuery ? "No notes match your search." : "No notes found."}
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
          {viewMode === "all" && hasMore && (
            <div style={{ textAlign: "center", marginTop: "1rem" }}>
              <button onClick={loadMoreNotes} disabled={isLoadingNotes} className="btn-secondary" style={{ minWidth: "180px" }}>
                {isLoadingNotes ? (
                  <><Loader2 size={14} className="spin" /> Loading...</>
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
