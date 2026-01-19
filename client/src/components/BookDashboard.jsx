import React, { useState, useEffect, useRef } from "react";
import api from "../api";
import { toast } from "react-hot-toast";
import ReactMarkdown from "react-markdown";
import NoteCard from "./NoteCard";
import Loading from "./layout/Loading";

const BookDashboard = ({ bookId, onDelete }) => {
  const [book, setBook] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [selectedChapterId, setSelectedChapterId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [allNotes, setAllNotes] = useState([]);

  // Local loading states for manual triggers
  const [loadingStep, setLoadingStep] = useState(null); // { chapterId: string, step: string } or null
  const abortControllerRef = useRef(null);

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
        !api.isCancel(err) &&
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

    const interval = setInterval(() => {
      setBook((prev) => {
        if (prev && (prev.status === "done" || prev.status === "error")) {
          clearInterval(interval);
          return prev;
        }
        fetchBook(controller.signal);
        return prev;
      });
    }, 3000);

    return () => {
      controller.abort();
      clearInterval(interval);
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
          prev && prev.chapterId === data.chapterId ? null : prev
        );
      } else if (data.type === "chapterStatus") {
        // Optimistically update chapter status in local state
        setBook((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            chapters: prev.chapters.map((c) =>
              c.id === data.chapterId ? { ...c, status: data.status } : c
            ),
          };
        });
      } else if (data.type === "overviewStream") {
        setStreamingOverviews((prev) => ({
          ...prev,
          [data.chapterId]: data.content,
        }));
      }
    };
    return () => evtSource.close();
  }, [bookId]);

  useEffect(() => {
    api.get("/notes").then((res) => setAllNotes(res.data));
  }, [book]); // Refresh notes when book updates (e.g. generation done)

  const handleUpdateNote = (updatedNote) => {
    setAllNotes((prev) =>
      prev.map((n) => (n.id === updatedNote.id ? updatedNote : n))
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
            : c
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
            : c
        ),
      }));
    } catch (err) {
      toast.error("Failed to skip");
    }
  };

  const handleRegenerateBook = async () => {
    if (
      !window.confirm(
        "This will regenerate all AI content for this book. Continue?"
      )
    ) {
      return;
    }
    try {
      await api.post(`/books/${bookId}/regenerate`);
      toast.success("Book regeneration started");
      fetchBook();
    } catch (err) {
      toast.error("Failed to start regeneration");
    }
  };

  const handleRegenerateAnalysis = async () => {
    try {
      await api.post(`/books/${bookId}/regenerate-analysis`);
      toast.success("Analysis regeneration started");
      fetchBook();
    } catch (err) {
      toast.error("Failed to regenerate analysis");
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
    (n) => n.source?.chapterId === selectedChapterId
  );

  if (!book) return <Loading message="Loading book details..." />;

  const selectedChapter = book.chapters?.find(
    (c) => c.id === selectedChapterId
  );
  const summary = selectedChapter?.summary;

  const overviewContent =
    selectedChapterId && streamingOverviews[selectedChapterId]
      ? streamingOverviews[selectedChapterId]
      : summary?.overview || "";

  // Helper to render Generate Button or Loading State
  const renderGenerateButton = (step, label) => {
    // Map 'step' identifier to status field key
    // overview -> overviewStatus
    // analysis -> analysisStatus
    // notes -> notesStatus

    // Status can be: pending, processing, completed, skipped, failed
    // (plus undefined for old records -> treat as pending)

    const statusKey = step === "summary" ? "analysisStatus" : `${step}Status`;
    const status = selectedChapter?.[statusKey] || "pending";
    const apiEndpointStep = step === "summary" ? "analysis" : step;

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
            style={{ background: "var(--primary-color)" }}
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
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⚡</div>
          <p>{message}</p>
          <div style={{ marginTop: "1rem" }}>
            <button
              onClick={() => handleSkip(apiEndpointStep)}
              style={{
                background: "transparent",
                border: "1px solid #ef4444",
                color: "#ef4444",
                fontSize: "0.8rem",
                padding: "4px 8px",
              }}
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
            style={{ background: "var(--primary-color)" }}
          >
            {status === "failed" ? "Retry" : label}
          </button>

          {status !== "failed" && (
            <button
              onClick={() => handleSkip(apiEndpointStep)}
              style={{ background: "#6b7280" }}
            >
              Skip
            </button>
          )}
        </div>
      </div>
    );
  };

  const getTabStatusIcon = (status) => {
    switch (status) {
      case "completed":
        return "✅";
      case "skipped":
        return "⏭️";
      case "failed":
        return "❌";
      case "processing":
        return "⚡";
      default:
        return "";
    }
  };

  return (
    <div className="container book-dashboard">
      {/* Header Card */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <h3>{book.title}</h3>
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
              {(() => {
                // Compute effective status: check if all chapters are actually done
                const allChaptersDone = book.chapters?.every((chap) => {
                  const overviewDone =
                    chap.overviewStatus === "completed" ||
                    chap.overviewStatus === "skipped";
                  const analysisDone =
                    chap.analysisStatus === "completed" ||
                    chap.analysisStatus === "skipped";
                  const notesDone =
                    chap.notesStatus === "completed" ||
                    chap.notesStatus === "skipped";
                  return overviewDone && analysisDone && notesDone;
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
                      ? "⏳ Processing"
                      : effectiveStatus === "done"
                      ? "✅ Ready"
                      : "Error"}
                  </span>
                );
              })()}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            {statusMsg && (
              <div
                style={{
                  color: "var(--processing-color)",
                  marginBottom: "0.5rem",
                }}
              >
                ⚡ {statusMsg}
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={handleRegenerateBook}
                style={{ background: "#f59e0b", fontSize: "0.8rem" }}
              >
                🔄 Regenerate All
              </button>
              <button
                onClick={handleDelete}
                style={{ background: "#ef4444", fontSize: "0.8rem" }}
              >
                Delete Book
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
              chap.analysisStatus === "processing" ||
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
              chap.analysisStatus === "skipped" &&
              chap.notesStatus === "skipped"
            ) {
              badgeText = "Skipped";
              badgeColor = "#6b7280";
            } else if (
              // Fallback: Check if all stages are technically done (completed or skipped)
              // but main status might not have updated yet
              (chap.overviewStatus === "completed" ||
                chap.overviewStatus === "skipped") &&
              (chap.analysisStatus === "completed" ||
                chap.analysisStatus === "skipped") &&
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
                  📖 Overview {getTabStatusIcon(selectedChapter.overviewStatus)}
                </button>
                <button
                  className={`tab-btn ${
                    activeTab === "summary" ? "active" : ""
                  }`}
                  onClick={() => setActiveTab("summary")}
                >
                  🎯 Structured Analysis{" "}
                  {getTabStatusIcon(selectedChapter.analysisStatus)}
                </button>
                <button
                  className={`tab-btn ${activeTab === "notes" ? "active" : ""}`}
                  onClick={() => setActiveTab("notes")}
                >
                  🧠 Atomic Notes ({chapterNotes.length}){" "}
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
                          gap: "0.5rem",
                          marginBottom: "1rem",
                        }}
                      >
                        <button
                          onClick={() => handleGenerate("overview")}
                          style={{
                            background: "#f59e0b",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          🔄 Regenerate
                        </button>
                        <button
                          onClick={handleListen}
                          disabled={isAudioLoading}
                          style={{
                            background: isPlaying
                              ? "#ef4444"
                              : "var(--primary-color)",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          {isAudioLoading ? (
                            "⏳ Loading..."
                          ) : isPlaying ? (
                            <>⏸ Stop Listening</>
                          ) : (
                            <>🔊 Listen to Overview</>
                          )}
                        </button>
                      </div>
                      <ReactMarkdown>{overviewContent}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}

              {/* STRUCTURED SUMMARY TAB */}
              {activeTab === "summary" &&
                (summary?.mainIdea &&
                selectedChapter.analysisStatus !== "skipped" ? (
                  <div className="markdown-content">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginBottom: "1rem",
                      }}
                    >
                      <button
                        onClick={() => handleGenerate("analysis")}
                        style={{
                          background: "#f59e0b",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        🔄 Regenerate
                      </button>
                    </div>
                    <h3>🎯 Main Idea</h3>
                    <p>{summary.mainIdea}</p>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "1rem",
                        marginTop: "1rem",
                      }}
                    >
                      <div>
                        <h4>🔑 Key Concepts</h4>
                        <ul>
                          {summary.keyConcepts?.map((k, i) => (
                            <li key={i}>{k}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4>🧠 Mental Models</h4>
                        <ul>
                          {summary.mentalModels?.map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <h4 style={{ marginTop: "1rem" }}>💡 Examples</h4>
                    <ul>
                      {summary.examples?.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>

                    <h4>🌱 Life Lessons</h4>
                    <ul>
                      {summary.lifeLessons?.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  renderGenerateButton("summary", "Generate Data")
                ))}

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
                        >
                          🔄 Regenerate
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
          <h2 style={{ margin: 0 }}>📘 Overall Book Analysis</h2>
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
            >
              🔄 Regenerate
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
            <button
              onClick={handleRegenerateAnalysis}
              style={{ background: "var(--primary-color)" }}
            >
              Generate Book Analysis
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BookDashboard;
