import React, { useState, useEffect, useRef } from "react";
import { ArrowLeft, Pencil, RefreshCw, Trash2, CheckCircle2, Clock, XCircle, Zap, SkipForward, BookOpen, Brain, BookText, Volume2, Pause, Loader2, X } from "lucide-react";
import axios from "axios";
import api from "../api";
import { toast } from "react-hot-toast";
import ReactMarkdown from "react-markdown";
import NoteCard from "./NoteCard";
import Loading from "./layout/Loading";
import "../styles/dashboard.css";

const BookDashboard = ({ bookId, onDelete, onBack }) => {
  const [book, setBook] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [selectedChapterId, setSelectedChapterId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [allNotes, setAllNotes] = useState([]);

  // Title Editing State
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");

  const handleSaveTitle = async () => {
    try {
      await api.patch(`/books/${bookId}`, { title: editedTitle });
      setBook((prev) => ({ ...prev, title: editedTitle }));
      setIsEditingTitle(false);
      toast.success("Title updated");
    } catch (err) {
      toast.error("Failed to update title");
    }
  };

  const handleCancelEdit = () => {
    setIsEditingTitle(false);
    setEditedTitle("");
  };

  // Type Editing State
  const [isEditingType, setIsEditingType] = useState(false);
  const [editedBookType, setEditedBookType] = useState("nonfiction");
  const [editedSourceType, setEditedSourceType] = useState("book");

  const handleSaveType = async () => {
    try {
      const payloadSource =
        editedSourceType === "book" ? null : editedSourceType;
      await api.patch(`/books/${bookId}`, {
        bookType: editedBookType,
        sourceType: payloadSource,
      });
      setBook((prev) => ({
        ...prev,
        bookType: editedBookType,
        sourceType: payloadSource,
      }));
      setIsEditingType(false);
      toast.success("Book type updated");
    } catch (err) {
      toast.error("Failed to update type");
    }
  };

  const [loadingStep, setLoadingStep] = useState(null); // { chapterId: string, step: string } or null
  const abortControllerRef = useRef(null);
  const [isRegeneratingBook, setIsRegeneratingBook] = useState(false);
  const [isRegeneratingAnalysis, setIsRegeneratingAnalysis] = useState(false);
  const [popupNote, setPopupNote] = useState(null);

  // Streaming State
  const [streamingOverviews, setStreamingOverviews] = useState({});

  // Audio State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const audioRef = useRef(null);

  // Cleanup audio when chapter changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setIsAudioLoading(false);
  }, [selectedChapterId]);

  const hasAutoSelected = useRef(false);

  // Fetch Logic
  const fetchBook = async (signal) => {
    try {
      const response = await api.get(`/books/${bookId}`, { signal });
      setBook(response.data);

      if (
        !selectedChapterId &&
        response.data.chapters?.length > 0 &&
        !hasAutoSelected.current
      ) {
        setSelectedChapterId(response.data.chapters[0].id);
        hasAutoSelected.current = true;
      }
    } catch (err) {
      if (
        !axios.isCancel(err) &&
        err.name !== "CanceledError" &&
        err.name !== "AbortError"
      ) {
        console.error("Failed to fetch book", err);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    hasAutoSelected.current = false;
    setSelectedChapterId(null);
    setBook(null);
    setStreamingOverviews({});
    setLoadingStep(null);

    fetchBook(controller.signal);

    // Removed polling - SSE handles real-time updates

    return () => {
      controller.abort();
    };
  }, [bookId]);

  useEffect(() => {
    if (!bookId) return;
    const evtSource = new EventSource(`/api/books/${bookId}/events`);
    evtSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "status") {
        setStatusMsg(data.message);
      } else if (data.type === "bookDone" || data.type === "chapterDone") {
        fetchBook();
        setStatusMsg("");
        // Only clear loading step if it was for the affected chapter
        setLoadingStep((prev) =>
          prev && prev.chapterId === data.chapterId ? null : prev,
        );
      } else if (data.type === "chapterStatus") {
        // Optimistically update chapter status in local state
        setBook((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            chapters: prev.chapters.map((c) =>
              c.id === data.chapterId ? { ...c, status: data.status } : c,
            ),
          };
        });
      } else if (data.type === "bookUpdate") {
        setBook(data.book);
        if (!selectedChapterId && data.book.chapters?.length > 0) {
          setSelectedChapterId(data.book.chapters[0].id);
        }
      } else if (data.type === "overviewStream") {
        setStreamingOverviews((prev) => ({
          ...prev,
          [data.chapterId]: data.content,
        }));
      }
    };
    return () => evtSource.close();
  }, [bookId]);

  // Memoize chapter IDs to prevent unnecessary refetches
  const chapterIds = React.useMemo(
    () => book?.chapters?.map((c) => c.id).join(",") || "",
    [book?.chapters],
  );

  useEffect(() => {
    // Only fetch notes when chapters change (e.g., generation complete)
    if (chapterIds) {
      api.get("/notes?all=true").then((res) => setAllNotes(res.data));
    }
  }, [chapterIds]); // Depend on stable chapter IDs, not entire book object

  const handleUpdateNote = (updatedNote) => {
    setAllNotes((prev) =>
      prev.map((n) => (n.id === updatedNote.id ? updatedNote : n)),
    );
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await api.delete(`/notes/${noteId}`);
      // Update the local state to remove the deleted note
      setAllNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success("Note deleted");
    } catch (err) {
      console.error("Failed to delete note", err);
      toast.error("Failed to delete note");
    }
  };

  const handleDelete = async () => {
    // Cancel any ongoing generation request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    try {
      console.log("Deleting Book:", bookId);
      await api.delete(`/books/${bookId}`);
      toast.success("Book deleted");
      onDelete(); // Parent refresh
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete book");
    }
  };

  // Manual Generators
  const handleGenerate = async (step) => {
    if (!selectedChapterId) return;
    setLoadingStep({ chapterId: selectedChapterId, step });

    // Optimistically update chapter status to 'queued'
    setBook((prevBook) => {
      if (!prevBook) return prevBook;
      return {
        ...prevBook,
        chapters: prevBook.chapters.map((c) =>
          c.id === selectedChapterId
            ? { ...c, [`${step}Status`]: "processing" }
            : c,
        ),
      };
    });

    // Create a new AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      await api.post(`/chapters/${selectedChapterId}/${step}`, null, {
        signal: controller.signal,
      });
      // SSE will catch completion
    } catch (err) {
      // Detect cancellation
      if (
        err.name === "AbortError" ||
        err.message === "canceled" ||
        err.code === "ERR_CANCELED"
      ) {
        toast("Generation cancelled");
      } else {
        toast.error(`Failed to start ${step}: ${err.message}`);
      }
      setLoadingStep(null);
    } finally {
      // Clear abort controller reference
      abortControllerRef.current = null;
    }
  };

  const handleSkip = async (stage) => {
    if (!selectedChapterId) return;
    try {
      await api.post(`/chapters/${selectedChapterId}/skip/${stage}`);
      toast.success(`Skipped ${stage}`);
      // Update local state immediately
      setBook((prev) => ({
        ...prev,
        chapters: prev.chapters.map((c) =>
          c.id === selectedChapterId
            ? { ...c, [`${stage}Status`]: "skipped" }
            : c,
        ),
      }));
    } catch (err) {
      toast.error("Failed to skip");
    }
  };

  const handleRegenerateBook = async () => {
    if (
      !window.confirm(
        "This will regenerate all AI content for this book. Continue?",
      )
    ) {
      return;
    }
    setIsRegeneratingBook(true);
    try {
      await api.post(`/books/${bookId}/regenerate`);
      toast.success("Book regeneration started");
      fetchBook();
    } catch (err) {
      toast.error("Failed to start regeneration");
    } finally {
      setIsRegeneratingBook(false);
    }
  };

  const handleRegenerateAnalysis = async () => {
    setIsRegeneratingAnalysis(true);
    try {
      await api.post(`/books/${bookId}/regenerate-analysis`);
      toast.success("Analysis regeneration started");
      fetchBook();
    } catch (err) {
      toast.error("Failed to regenerate analysis");
    } finally {
      setIsRegeneratingAnalysis(false);
    }
  };

  const handleSkipAnalysis = async () => {
    try {
      await api.post(`/books/${bookId}/skip-analysis`);
      toast.success("Book analysis skipped");
      fetchBook();
    } catch (err) {
      toast.error("Failed to skip analysis");
    }
  };

  const handleListen = async () => {
    if (!selectedChapterId) return;

    // Toggle Play/Pause if audio exists
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    // Fetch and Play
    try {
      setIsAudioLoading(true);
      // We can use the direct URL since the backend streams it
      // For audio element, we need FULL URL if it's external, or relative.
      // Since we updated routes, it is /api/chapters/...
      // api.defaults.baseURL is /api, but new Audio() doesn't use axios.
      // So we must include /api manually here, which is correct for current setup.
      const audioUrl = `/api/chapters/${selectedChapterId}/audio`;

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => setIsPlaying(false);
      audio.onpause = () => setIsPlaying(false);
      audio.onplay = () => setIsPlaying(true);

      // Wait for metadata or just play
      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      toast.error("Failed to play audio");
      console.error(err);
    } finally {
      setIsAudioLoading(false);
    }
  };

  const chapterNotes = allNotes.filter(
    (n) => n.source?.chapterId === selectedChapterId,
  );

  if (!book) return <Loading message="Loading book details..." />;

  const selectedChapter = book.chapters?.find(
    (c) => c.id === selectedChapterId,
  );
  const summary = selectedChapter?.summary;

  // Sanitize AI-generated markdown to fix rendering issues
  const sanitizeMarkdown = (text) => {
    if (!text) return text;

    let result = text;

    // 1. Fix single-line markdown tables: convert them into structured bullet lists
    // Matches patterns like: | Header1 | Header2 | ... | |---| ... | Cell1 | Cell2 | ...
    // These appear when the AI outputs an entire table on one line
    const singleLineTablePattern = /\|[^|\n]+(?:\|[^|\n]+){2,}/;
    if (singleLineTablePattern.test(result) && !result.includes('\n|')) {
      // Split the single-line mess into rows by finding | followed by | patterns
      // First, insert newlines before each row start (after separator row and data rows)
      // Strategy: split by | and rebuild
      
      // Extract all cells by splitting on |
      const cells = result.split('|').map(c => c.trim()).filter(c => c && !c.match(/^[-:]+$/));
      
      if (cells.length > 0) {
        // Try to detect headers (first few cells before a separator like ---)
        const rawParts = result.split('|').map(c => c.trim()).filter(Boolean);
        const sepIndex = rawParts.findIndex(p => /^[-:]+$/.test(p));
        
        let headers = [];
        let dataCells = [];
        
        if (sepIndex > 0) {
          headers = rawParts.slice(0, sepIndex).filter(h => !h.match(/^[-:]+$/));
          dataCells = rawParts.slice(sepIndex).filter(c => !c.match(/^[-:]+$/));
        } else {
          dataCells = cells;
        }
        
        const colCount = headers.length || 3; // fallback
        
        // Group data cells into rows
        const rows = [];
        for (let i = 0; i < dataCells.length; i += colCount) {
          rows.push(dataCells.slice(i, i + colCount));
        }
        
        // Convert to bullet list format
        let converted = '';
        rows.forEach((row, idx) => {
          if (headers.length > 0 && row.length > 0) {
            converted += `\n**${row[0] || `Item ${idx + 1}`}**\n\n`;
            for (let c = 1; c < row.length; c++) {
              if (row[c]) {
                const label = headers[c] ? `**${headers[c]}:** ` : '';
                // Convert <br> tags to actual line breaks within cells
                const cellContent = row[c].replace(/<br\s*\/?>/gi, '\n  ');
                converted += `- ${label}${cellContent}\n`;
              }
            }
            converted += '\n';
          } else {
            row.forEach(cell => {
              if (cell) {
                const cellContent = cell.replace(/<br\s*\/?>/gi, '\n  ');
                converted += `- ${cellContent}\n`;
              }
            });
          }
        });
        
        result = converted;
      }
    }

    // 2. Convert properly-formatted multi-line markdown tables to bullet lists too
    // Match multi-line tables: lines starting with |
    const multiLineTableRegex = /(?:^|\n)(\|.+\|(?:\n\|.+\|)+)/g;
    result = result.replace(multiLineTableRegex, (match, tableBlock) => {
      const lines = tableBlock.trim().split('\n').filter(l => l.trim());
      
      // Skip if too few lines
      if (lines.length < 3) return match;
      
      // Parse header row
      const headerLine = lines[0];
      const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
      
      // Skip separator row (line with dashes)
      const dataLines = lines.slice(2); // skip header + separator
      
      let converted = '\n';
      dataLines.forEach((line, idx) => {
        const cells = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length === 0) return;
        
        converted += `**${cells[0] || `Item ${idx + 1}`}**\n\n`;
        for (let c = 1; c < cells.length; c++) {
          if (cells[c]) {
            const label = headers[c] ? `**${headers[c]}:** ` : '';
            const cellContent = cells[c].replace(/<br\s*\/?>/gi, '\n  ');
            converted += `- ${label}${cellContent}\n`;
          }
        }
        converted += '\n';
      });
      
      return converted;
    });

    // 3. Convert remaining <br> tags to newlines
    result = result.replace(/<br\s*\/?>/gi, '\n');

    // 4. Convert bullet character • to standard markdown dash
    result = result.replace(/•/g, '-');

    return result;
  };

  const rawOverviewContent =
    selectedChapterId && streamingOverviews[selectedChapterId]
      ? streamingOverviews[selectedChapterId]
      : summary?.overview || "";

  const overviewContent = sanitizeMarkdown(rawOverviewContent);

  // Helper to render Generate Button or Loading State
  const renderGenerateButton = (step, label) => {
    // Map 'step' identifier to status field key
    // overview -> overviewStatus
    // analysis -> analysisStatus
    // notes -> notesStatus

    // Status can be: pending, processing, completed, skipped, failed
    // (plus undefined for old records -> treat as pending)

    const statusKey = `${step}Status`;
    const status = selectedChapter?.[statusKey] || "pending";
    const apiEndpointStep = step;

    // Check if this specific chapter AND step is loading locally
    const isLocallyLoading =
      loadingStep &&
      loadingStep.chapterId === selectedChapter?.id &&
      loadingStep.step === apiEndpointStep;

    if (status === "skipped") {
      return (
        <div
          style={{
            textAlign: "center",
            padding: "2rem",
            border: "1px dashed var(--border-color)",
            borderRadius: "8px",
            marginTop: "1rem",
            background: "rgba(107, 114, 128, 0.05)",
          }}
        >
          <p style={{ marginBottom: "1rem", opacity: 0.7 }}>
            You skipped this stage.
          </p>
          <button
            onClick={() => handleGenerate(apiEndpointStep)}
            className="btn-primary"
          >
            Regenerate {label}
          </button>
        </div>
      );
    }

    if (status === "processing" || isLocallyLoading) {
      const message = "Generating content...";

      return (
        <div
          style={{
            textAlign: "center",
            padding: "3rem",
            opacity: 0.7,
            animation: "pulse 1.5s infinite",
          }}
        >
          <div style={{ marginBottom: "1rem" }}><Zap size={28} style={{ color: 'var(--warning)' }} /></div>
          <p>{message}</p>
          <div style={{ marginTop: "1rem" }}>
            <button
              onClick={() => handleSkip(apiEndpointStep)}
              className="btn-ghost"
              style={{ color: "var(--error)", borderColor: "var(--error)" }}
            >
              Stop & Skip
            </button>
          </div>
        </div>
      );
    }

    // Failed or Pending
    return (
      <div
        style={{
          textAlign: "center",
          padding: "2rem",
          border: "1px dashed var(--border-color)",
          borderRadius: "8px",
          marginTop: "1rem",
        }}
      >
        <p style={{ marginBottom: "1rem", opacity: 0.7 }}>
          {status === "failed"
            ? "Generation Failed."
            : "Content not generated yet."}
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
          <button
            onClick={() => handleGenerate(apiEndpointStep)}
            className="btn-primary"
          >
            {status === "failed" ? "Retry" : label}
          </button>

          <button
            onClick={() => handleSkip(apiEndpointStep)}
            className="btn-ghost"
          >
            Skip
          </button>
        </div>
      </div>
    );
  };

  const getTabStatusIcon = (status) => {
    const iconStyle = { marginLeft: '4px', verticalAlign: 'middle' };
    switch (status) {
      case "completed":
        return <CheckCircle2 size={12} style={{ ...iconStyle, color: 'var(--success)' }} />;
      case "skipped":
        return <SkipForward size={12} style={{ ...iconStyle, color: 'var(--text-tertiary)' }} />;
      case "failed":
        return <XCircle size={12} style={{ ...iconStyle, color: 'var(--error)' }} />;
      case "processing":
        return <Zap size={12} style={{ ...iconStyle, color: 'var(--warning)' }} />;
      default:
        return "";
    }
  };

  return (
    <div className="container book-dashboard">
      <div style={{ marginBottom: "1rem" }}>
        <button
          onClick={onBack}
          className="btn-ghost"
          style={{ paddingLeft: 0 }}
        >
          <ArrowLeft size={20} /> Back to Library
        </button>
      </div>

      {/* Header Card */}
      <div className="card">
        <div className="book-header-wrapper">
          <div className="book-header-left">
            {/* Title Editing Logic */}
            {isEditingTitle ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginBottom: "5px",
                }}
              >
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: "bold",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    border: "1px solid var(--border-color)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-color)",
                  }}
                />
                <button
                  onClick={handleSaveTitle}
                  className="btn-primary"
                  style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                >
                  Save
                </button>
                <button
                  onClick={handleCancelEdit}
                  style={{
                    padding: "4px 8px",
                    fontSize: "0.8rem",
                    background: "var(--text-muted)",
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  minWidth: 0,
                  flex: 1,
                  overflow: "hidden",
                }}
              >
                <h1
                  className="truncate book-title"
                  style={{
                    fontSize: "2rem",
                    maxWidth: "100%",
                    minWidth: 0,
                  }}
                  title={book.title}
                >
                  {book.title}
                </h1>
                <button
                  onClick={() => {
                    setEditedTitle(book.title);
                    setIsEditingTitle(true);
                  }}
                  className="btn-ghost btn-icon"
                  style={{ flexShrink: 0 }}
                  title="Edit Title"
                >
                  <Pencil size={14} />
                </button>
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginTop: "5px",
              }}
            >
              <span className="text-secondary">
                {book.chapters?.length} Chapters
              </span>
              <span style={{ color: "var(--border-color)" }}>|</span>

              {isEditingType ? (
                <div
                  style={{ display: "flex", gap: "5px", alignItems: "center" }}
                >
                  <select
                    value={editedSourceType}
                    onChange={(e) => setEditedSourceType(e.target.value)}
                    style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      background: "var(--bg-main)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                    <option value="book">Book (PDF)</option>
                    <option value="youtube">YouTube</option>
                    <option value="blog">Article</option>
                  </select>

                  <select
                    value={editedBookType}
                    onChange={(e) => setEditedBookType(e.target.value)}
                    style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      background: "var(--bg-main)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                    <option value="nonfiction">Non-Fiction</option>
                    <option value="fiction">Fiction</option>
                  </select>

                  <button
                    onClick={handleSaveType}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "1rem",
                      padding: "0 4px",
                    }}
                    title="Save"
                  >
                    <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                  </button>
                  <button
                    onClick={() => setIsEditingType(false)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      padding: "0 4px",
                    }}
                    title="Cancel"
                  >
                    <XCircle size={14} style={{ color: 'var(--error)' }} />
                  </button>
                </div>
              ) : (
                <div
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <span
                    className="text-secondary"
                    style={{
                      background: "var(--bg-surface-2)",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "0.8rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>
                      {book.sourceType === "youtube"
                        ? "YouTube"
                        : book.sourceType === "blog"
                          ? "Article"
                          : "Book"}
                    </span>
                    <span style={{ opacity: 0.3 }}>•</span>
                    <span>
                      {book.bookType === "fiction" ? "Fiction" : "Non-Fiction"}
                    </span>
                  </span>
                  <button
                    onClick={() => {
                      setEditedBookType(book.bookType || "nonfiction");
                      setEditedSourceType(book.sourceType || "book");
                      setIsEditingType(true);
                    }}
                    className="btn-ghost btn-icon"
                    style={{ padding: "2px", height: "auto", minHeight: "0" }}
                    title="Edit Type"
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              )}
              {(() => {
                // Compute effective status: check if all chapters are actually done
                const allChaptersDone = book.chapters?.every((chap) => {
                  const overviewDone =
                    chap.overviewStatus === "completed" ||
                    chap.overviewStatus === "skipped";
                  const notesDone =
                    chap.notesStatus === "completed" ||
                    chap.notesStatus === "skipped";
                  return overviewDone && notesDone;
                });

                const effectiveStatus =
                  allChaptersDone && book.chapters?.length > 0
                    ? "done"
                    : book.status;

                return (
                  <span
                    className={`status-badge status-${effectiveStatus}`}
                    style={{
                      fontSize: "0.75rem",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      background:
                        effectiveStatus === "processing"
                          ? "rgba(245, 158, 11, 0.2)"
                          : effectiveStatus === "done"
                            ? "rgba(16, 185, 129, 0.2)"
                            : "rgba(239, 68, 68, 0.2)",
                      color:
                        effectiveStatus === "processing"
                          ? "#fbbf24"
                          : effectiveStatus === "done"
                            ? "#34d399"
                            : "#f87171",
                      border: "1px solid currentColor",
                    }}
                  >
                    {effectiveStatus === "processing"
                      ? <><Clock size={11} style={{ marginRight: '3px' }} /> Processing</>
                      : effectiveStatus === "done"
                        ? <><CheckCircle2 size={11} style={{ marginRight: '3px' }} /> Ready</>
                        : "Error"}
                  </span>
                );
              })()}
            </div>
          </div>
          <div className="book-header-right">
            {statusMsg && (
              <div
                style={{
                  color: "var(--processing-color)",
                  marginBottom: "0.5rem",
                }}
              >
                <Zap size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} /> {statusMsg}
              </div>
            )}
            <div className="book-header-actions">
              <button
                onClick={handleRegenerateBook}
                className="btn-ghost"
                style={{ color: "var(--warning)" }}
                disabled={isRegeneratingBook}
              >
                {isRegeneratingBook ? (
                  <><Loader2 size={13} className="spin" /> Starting...</>
                ) : (
                  <><RefreshCw size={13} /> Regenerate All</>
                )}
              </button>
              <button
                onClick={handleDelete}
                className="btn-ghost"
                style={{ color: "var(--error)" }}
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard card">
        {/* Sidebar: Chapters */}
        <div className="chunk-list">
          <h4>Chapters</h4>
          {book.chapters?.map((chap) => {
            // New Badge Logic
            let badgeText = "Pending";
            let badgeClass = "pending";
            // Colors hardcoded in style for now
            let badgeColor = "#9ca3af";
            let badgeBg = "rgba(156, 163, 175, 0.2)";

            if (chap.status === "completed") {
              badgeText = "Ready";
              badgeColor = "#34d399";
              badgeBg = "rgba(16, 185, 129, 0.2)";
            } else if (chap.status === "failed") {
              badgeText = "Failed";
              badgeColor = "#f87171";
              badgeBg = "rgba(239, 68, 68, 0.2)";
            } else if (
              chap.overviewStatus === "processing" ||
              chap.notesStatus === "processing" ||
              chap.status === "summarization" || // legacy fallback
              chap.status === "atomic_notes"
            ) {
              badgeText = "Generating";
              badgeColor = "#fbbf24";
              badgeBg = "rgba(245, 158, 11, 0.2)";
            } else if (
              // If all marked skipped
              chap.overviewStatus === "skipped" &&
              chap.notesStatus === "skipped"
            ) {
              badgeText = "Skipped";
              badgeColor = "#6b7280";
            } else if (
              // Fallback: Check if all stages are technically done (completed or skipped)
              // but main status might not have updated yet
              (chap.overviewStatus === "completed" ||
                chap.overviewStatus === "skipped") &&
              (chap.notesStatus === "completed" ||
                chap.notesStatus === "skipped")
            ) {
              badgeText = "Ready";
              badgeColor = "#34d399";
              badgeBg = "rgba(16, 185, 129, 0.2)";
            }

            const statusBadge = (
              <span
                style={{
                  fontSize: "0.7rem",
                  padding: "2px 6px",
                  borderRadius: "8px",
                  background: badgeBg,
                  color: badgeColor,
                  border: "1px solid currentColor",
                  marginLeft: "0.5rem",
                }}
              >
                {badgeText}
              </span>
            );

            return (
              <div
                key={chap.id}
                className={`chunk-item ${
                  selectedChapterId === chap.id ? "active" : ""
                }`}
                onClick={() => setSelectedChapterId(chap.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>Chapter {chap.chapterIndex}</span>
                {statusBadge}
              </div>
            );
          })}
        </div>

        {/* Content Area */}
        <div className="content-area">
          {selectedChapter ? (
            <div>
              <div className="dashboard-tabs">
                <button
                  className={`tab-btn ${
                    activeTab === "overview" ? "active" : ""
                  }`}
                  onClick={() => setActiveTab("overview")}
                >
                  <BookOpen size={14} /> Overview {getTabStatusIcon(selectedChapter.overviewStatus)}
                </button>
                <button
                  className={`tab-btn ${activeTab === "notes" ? "active" : ""}`}
                  onClick={() => setActiveTab("notes")}
                >
                  <Brain size={14} /> Atomic Notes ({chapterNotes.length}){" "}
                  {getTabStatusIcon(selectedChapter.notesStatus)}
                </button>
              </div>

              {/* OVERVIEW TAB */}
              {activeTab === "overview" && (
                <div className="markdown-content">
                  {!overviewContent ||
                  selectedChapter.overviewStatus === "skipped" ? (
                    renderGenerateButton("overview", "Generate Overview")
                  ) : (
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "flex-end",
                          gap: "0.75rem",
                          marginBottom: "1.5rem",
                        }}
                      >
                        <button
                          onClick={() => handleGenerate("overview")}
                          className="btn-secondary"
                          style={{
                            borderRadius: "12px",
                            padding: "0.6rem 1.25rem",
                            fontSize: "0.9rem",
                          }}
                          disabled={selectedChapter.overviewStatus === 'processing' || (loadingStep && loadingStep.chapterId === selectedChapter.id && loadingStep.step === "overview")}
                        >
                          {(loadingStep && loadingStep.chapterId === selectedChapter.id && loadingStep.step === "overview") || selectedChapter.overviewStatus === 'processing' ? (
                            <><Loader2 size={13} className="spin" /> Generating...</>
                          ) : (
                            <><RefreshCw size={13} /> Regenerate</>
                          )}
                        </button>
                        <button
                          onClick={handleListen}
                          disabled={isAudioLoading}
                          className="btn-primary"
                          style={{
                            background: isPlaying
                              ? "var(--error)"
                              : "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)",
                            borderColor: "transparent",
                            borderRadius: "12px",
                            padding: "0.6rem 1.5rem",
                            fontSize: "0.9rem",
                            boxShadow: isPlaying
                              ? "none"
                              : "0 4px 12px rgba(139, 92, 246, 0.3)",
                            fontWeight: "700",
                          }}
                        >
                          {isAudioLoading ? (
                            <><Loader2 size={14} className="spin" /> Loading...</>
                          ) : isPlaying ? (
                            <><Pause size={14} /> Stop Listening</>
                          ) : (
                            <><Volume2 size={14} /> Listen to Overview</>
                          )}
                        </button>
                      </div>
                      <ReactMarkdown>{overviewContent}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}


              {/* ATOMIC NOTES TAB */}
              {activeTab === "notes" && (
                <div>
                  {chapterNotes.length > 0 &&
                  selectedChapter.notesStatus !== "skipped" ? (
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "flex-end",
                          marginBottom: "1rem",
                        }}
                      >
                        <button
                          onClick={() => handleGenerate("notes")}
                          style={{
                            background: "#f59e0b",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                          disabled={selectedChapter.notesStatus === 'processing' || (loadingStep && loadingStep.chapterId === selectedChapter.id && loadingStep.step === "notes")}
                        >
                          {(loadingStep && loadingStep.chapterId === selectedChapter.id && loadingStep.step === "notes") || selectedChapter.notesStatus === 'processing' ? (
                            <><Loader2 size={13} className="spin" /> Generating...</>
                          ) : (
                            <><RefreshCw size={13} /> Regenerate</>
                          )}
                        </button>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fill, minmax(280px, 1fr))",
                          gap: "1rem",
                        }}
                      >
                        {chapterNotes.map((note) => (
                          <NoteCard
                            key={note.id}
                            note={note}
                            onUpdate={handleUpdateNote}
                            onDeleteNote={handleDeleteNote}
                            onSelect={() => setPopupNote(note)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    renderGenerateButton("notes", "Generate Notes")
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: "2rem", textAlign: "center" }}>
              Select a chapter to view insights
            </div>
          )}
        </div>
      </div>

      {/* Overall Analysis Section */}
      <div className="card" style={{ marginTop: "2rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><BookText size={20} style={{ color: 'var(--primary)' }} /> Overall Book Analysis</h2>
          {book.overallAnalysis && (
            <button
              onClick={handleRegenerateAnalysis}
              style={{
                background: "#f59e0b",
                fontSize: "0.8rem",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
              disabled={isRegeneratingAnalysis}
            >
              {isRegeneratingAnalysis ? (
                <><Loader2 size={13} className="spin" /> Starting...</>
              ) : (
                <><RefreshCw size={13} /> Regenerate</>
              )}
            </button>
          )}
        </div>

        {book.overallAnalysis ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "2rem",
            }}
          >
            <div>
              <h4>Core Themes</h4>
              <ul>
                {book.overallAnalysis.coreThemes?.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              <h4>Key Takeaways</h4>
              <ul>
                {book.overallAnalysis.keyTakeaways?.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Mental Models</h4>
              <ul>
                {book.overallAnalysis.mentalModels?.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              <h4>Practical Applications</h4>
              <ul>
                {book.overallAnalysis.practicalApplications?.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : book.analysisSkipped ? (
          <div
            style={{
              textAlign: "center",
              padding: "2rem",
              border: "1px dashed var(--border-color)",
              borderRadius: "8px",
              background: "rgba(107, 114, 128, 0.05)",
            }}
          >
            <p style={{ marginBottom: "1rem", opacity: 0.7 }}>
              You skipped book analysis.
            </p>
            <button onClick={handleRegenerateAnalysis} className="btn-primary" disabled={isRegeneratingAnalysis}>
              {isRegeneratingAnalysis ? <><Loader2 size={14} className="spin" style={{marginRight: '6px'}}/> Starting...</> : "Generate Book Analysis"}
            </button>
          </div>
        ) : book.status === "analysis_failed" ? (
          <div
            style={{
              textAlign: "center",
              padding: "2rem",
              border: "1px dashed var(--border-color)",
              borderRadius: "8px",
            }}
          >
            <p
              style={{
                marginBottom: "0.5rem",
                opacity: 0.7,
                color: "var(--error)",
              }}
            >
              <XCircle size={14} style={{ color: 'var(--error)', display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} /> Book analysis generation failed.
            </p>
            {book.analysisError && (
              <p
                style={{
                  marginBottom: "1rem",
                  fontSize: "0.9rem",
                  opacity: 0.6,
                }}
              >
                Error: {book.analysisError}
              </p>
            )}
            <div
              style={{ display: "flex", gap: "10px", justifyContent: "center" }}
            >
              <button
                onClick={handleRegenerateAnalysis}
                className="btn-primary"
                disabled={isRegeneratingAnalysis}
              >
                {isRegeneratingAnalysis ? <><Loader2 size={14} className="spin" style={{marginRight: '6px'}}/> Starting...</> : "Retry"}
              </button>
              <button onClick={handleSkipAnalysis} className="btn-ghost">
                Skip
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "2rem",
              border: "1px dashed var(--border-color)",
              borderRadius: "8px",
            }}
          >
            <p style={{ marginBottom: "1rem", opacity: 0.7 }}>
              Overall book analysis not generated yet.
            </p>
            <div
              style={{ display: "flex", gap: "10px", justifyContent: "center" }}
            >
              <button
                onClick={handleRegenerateAnalysis}
                className="btn-primary"
                disabled={isRegeneratingAnalysis}
              >
                {isRegeneratingAnalysis ? <><Loader2 size={14} className="spin" style={{marginRight: '6px'}}/> Starting...</> : "Generate Book Analysis"}
              </button>
              <button onClick={handleSkipAnalysis} className="btn-ghost">
                Skip
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Atomic Note Popup Modal */}
      {popupNote && (
        <div
          onClick={() => setPopupNote(null)}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(2px)'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-main)',
              borderRadius: '12px',
              padding: '2rem',
              width: '90%',
              maxWidth: '600px',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid var(--border-color)'
            }}
            className="card"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 'bold' }}>{popupNote.title}</h2>
              <button
                onClick={() => setPopupNote(null)}
                className="btn-ghost btn-icon"
                style={{ padding: '4px', marginTop: '-4px', marginRight: '-4px' }}
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ fontSize: '1.05rem', lineHeight: '1.6', color: 'var(--text-secondary)', marginBottom: '2rem', whiteSpace: 'pre-wrap' }}>
              {popupNote.content}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {popupNote.tags?.map((t) => (
                <span key={t} className="note-tag" style={{ background: 'var(--bg-surface-2)', padding: '4px 10px', borderRadius: '12px', fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
                  #{t}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookDashboard;
