import React, { useState, useEffect } from "react";
import api from "./api";
import { Toaster } from "react-hot-toast";
import Layout from "./components/layout/Layout";
import NoteView from "./components/views/NoteView";
import GraphView from "./components/views/GraphView";
import FolderView from "./components/views/FolderView";
import BookDashboard from "./components/BookDashboard";
import BookInput from "./components/BookInput";
import NotesExplorer from "./components/NotesExplorer";
import Loading from "./components/layout/Loading";
import "./styles/main-content.css";

/**
 * App - Main application with new 3-pane layout
 *
 * Views:
 * - home: Library view with book grid
 * - book: Book dashboard with chapters
 * - note: Single note view
 * - notes: All notes explorer
 * - graph: Graph visualization
 * - folders: AI-organized folders
 * - processing: Processing status (TODO: Phase 4)
 */
function App() {
  const [currentView, setCurrentView] = useState("home");
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [selectedBookId, setSelectedBookId] = useState(null);
  const [selectedBook, setSelectedBook] = useState(null);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  // View state preservation
  const [notesExplorerState, setNotesExplorerState] = useState(null);
  const [previousView, setPreviousView] = useState("home");

  useEffect(() => {
    fetchBooks();
  }, []);

  useEffect(() => {
    if (selectedBookId) {
      fetchBookDetails();
    }
  }, [selectedBookId]);

  const fetchBooks = async () => {
    try {
      const res = await api.get("/books");
      setBooks(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchBookDetails = async () => {
    try {
      const res = await api.get(`/books/${selectedBookId}`);
      setSelectedBook(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectView = (view, id = null, context = null) => {
    // If we are navigating to 'note', track where we came from
    if (view === "note") {
      setPreviousView(currentView);
    }

    // If we are navigating FROM 'notes' TO 'note', save the context
    if (currentView === "notes" && view === "note" && context) {
      setNotesExplorerState(context);
    }
    // If navigating to home or notes fresh, clear context
    else if (view === "home" || (view === "notes" && !context)) {
      if (view !== "notes") {
        setNotesExplorerState(null);
      }
    }

    setCurrentView(view);

    if (view === "book" && id) {
      setSelectedBookId(id);
      setSelectedNoteId(null);
    } else if (view === "note" && id) {
      setSelectedNoteId(id);
      setSelectedBookId(null);
    } else {
      setSelectedBookId(null);
      setSelectedNoteId(null);
      setSelectedBook(null);
    }
  };

  const handleBookAdded = (id) => {
    setSelectedBookId(id);
    setCurrentView("book");
    fetchBooks();
  };

  const handleDeleteBook = () => {
    setSelectedBookId(null);
    setSelectedBook(null);
    setCurrentView("home");
    fetchBooks();
  };

  const handleNoteUpdated = (updatedNote) => {
    // Refresh if needed
    console.log("Note updated:", updatedNote);
  };

  const renderMainContent = () => {
    switch (currentView) {
      case "note":
        return (
          <NoteView
            noteId={selectedNoteId}
            onNoteUpdated={handleNoteUpdated}
            onBack={() => {
              // Return to previous view
              handleSelectView(previousView);
            }}
            onSelectView={handleSelectView}
          />
        );

      case "graph":
        return (
          <GraphView
            onSelectNote={(noteId) => handleSelectView("note", noteId)}
            onBack={() => handleSelectView("home")}
          />
        );

      case "folders":
        return (
          <FolderView
            onSelectNote={(noteId) => handleSelectView("note", noteId)}
            onBack={() => handleSelectView("home")}
          />
        );

      case "notes":
        return (
          <NotesExplorer
            onSelectView={handleSelectView}
            initialState={notesExplorerState}
          />
        );

      case "book":
        return selectedBookId ? (
          <BookDashboard
            key={selectedBookId}
            bookId={selectedBookId}
            onDelete={handleDeleteBook}
            onBack={() => handleSelectView("home")}
            onSelectView={handleSelectView}
          />
        ) : (
          <div className="main-content-empty">
            Select a book from the sidebar
          </div>
        );

      case "home":
      default:
        return (
          <div className="container" style={{ padding: "var(--space-xl)" }}>
            <BookInput onBookAdded={handleBookAdded} />

            <div style={{ marginTop: "3rem" }}>
              <h2
                style={{ marginBottom: "1.5rem", color: "var(--text-primary)" }}
              >
                Your Library
              </h2>
              {loading ? (
                <Loading message="Fetching your library..." />
              ) : books.length === 0 ? (
                <div
                  className="text-secondary"
                  style={{ textAlign: "center", padding: "2rem" }}
                >
                  No books added yet.
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: "1.5rem",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(280px, 1fr))",
                  }}
                >
                  {books.map((book) => (
                    <div
                      key={book.id}
                      onClick={() => handleSelectView("book", book.id)}
                      className="card book-card"
                      style={{
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        position: "relative",
                        overflow: "hidden",
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.transform = "translateY(-4px)";
                        e.currentTarget.style.borderColor =
                          "var(--primary-color)";
                        e.currentTarget.style.boxShadow = "var(--shadow-lg)";
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.borderColor =
                          "var(--border-color)";
                        e.currentTarget.style.boxShadow = "var(--shadow-sm)";
                      }}
                    >
                      <div
                        className="flex-between"
                        style={{ alignItems: "flex-start" }}
                      >
                        <h3
                          className="truncate"
                          style={{
                            fontSize: "1.25rem",
                            margin: "0 0 0.5rem 0",
                            color: "var(--text-primary)",
                          }}
                          title={book.title}
                        >
                          {book.title}
                        </h3>
                      </div>
                      <p
                        className="text-secondary"
                        style={{ fontSize: "0.9rem", marginBottom: "1rem" }}
                      >
                        {book.chunkCount} Chapters
                      </p>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.75rem",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            background:
                              book.status === "done"
                                ? "rgba(16, 185, 129, 0.1)"
                                : book.status === "processing"
                                  ? "rgba(245, 158, 11, 0.1)"
                                  : "var(--bg-surface-3)",
                            color:
                              book.status === "done"
                                ? "var(--success)"
                                : book.status === "processing"
                                  ? "var(--warning)"
                                  : "var(--text-tertiary)",
                            border: "1px solid currentColor",
                            fontWeight: "600",
                          }}
                        >
                          {book.status === "processing"
                            ? "⏳ Processing"
                            : book.status === "done"
                              ? "✅ Complete"
                              : book.status}
                        </span>
                        <span
                          className="text-secondary"
                          style={{ fontSize: "0.8rem" }}
                        >
                          {new Date(book.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <Layout
      selectedNote={selectedNoteId ? { id: selectedNoteId } : null}
      selectedBook={selectedBook}
      onSelectView={handleSelectView}
      books={books}
    >
      {renderMainContent()}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#1e293b",
            color: "#fff",
            border: "1px solid rgba(148, 163, 184, 0.1)",
          },
        }}
      />
    </Layout>
  );
}

export default App;
