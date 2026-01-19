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

  const handleSelectView = (view, id = null) => {
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
          <NoteView noteId={selectedNoteId} onNoteUpdated={handleNoteUpdated} />
        );

      case "graph":
        return (
          <GraphView
            onSelectNote={(noteId) => handleSelectView("note", noteId)}
          />
        );

      case "folders":
        return (
          <FolderView
            onSelectNote={(noteId) => handleSelectView("note", noteId)}
          />
        );

      case "notes":
        return <NotesExplorer />;

      case "book":
        return selectedBookId ? (
          <BookDashboard
            key={selectedBookId}
            bookId={selectedBookId}
            onDelete={handleDeleteBook}
          />
        ) : (
          <div className="main-content-empty">
            Select a book from the sidebar
          </div>
        );

      case "home":
      default:
        return (
          <div style={{ padding: "var(--space-xl)" }}>
            <BookInput onBookAdded={handleBookAdded} />

            <div style={{ marginTop: "var(--space-xl)" }}>
              <h2
                style={{
                  marginBottom: "var(--space-lg)",
                  color: "var(--text-primary)",
                }}
              >
                Your Library
              </h2>
              {loading ? (
                <Loading message="Fetching your library..." />
              ) : books.length === 0 ? (
                <p style={{ color: "var(--text-tertiary)" }}>
                  No books added yet.
                </p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: "var(--space-md)",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(250px, 1fr))",
                  }}
                >
                  {books.map((book) => (
                    <div
                      key={book.id}
                      onClick={() => handleSelectView("book", book.id)}
                      style={{
                        background: "var(--card-bg)",
                        padding: "var(--space-lg)",
                        borderRadius: "var(--border-radius)",
                        border: "1px solid var(--border-color)",
                        cursor: "pointer",
                        transition: "all var(--transition-fast)",
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.borderColor =
                          "var(--accent-color)";
                        e.currentTarget.style.transform = "translateY(-2px)";
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.borderColor =
                          "var(--border-color)";
                        e.currentTarget.style.transform = "translateY(0)";
                      }}
                    >
                      <h3
                        style={{
                          fontSize: "var(--font-size-lg)",
                          marginBottom: "var(--space-sm)",
                          color: "var(--text-primary)",
                        }}
                      >
                        {book.title}
                      </h3>
                      <p
                        style={{
                          fontSize: "var(--font-size-sm)",
                          color: "var(--text-secondary)",
                          marginBottom: "var(--space-sm)",
                        }}
                      >
                        {book.chunkCount} Chapters
                      </p>
                      <span
                        style={{
                          fontSize: "var(--font-size-xs)",
                          color:
                            book.status === "done"
                              ? "var(--success)"
                              : book.status === "processing"
                              ? "var(--warning)"
                              : "var(--text-tertiary)",
                          textTransform: "uppercase",
                          fontWeight: "600",
                        }}
                      >
                        {book.status === "processing"
                          ? "⏳ Processing"
                          : book.status === "done"
                          ? "✅ Complete"
                          : book.status}
                      </span>
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
