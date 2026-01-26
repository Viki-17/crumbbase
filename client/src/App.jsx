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
import HomeView from "./components/views/HomeView";
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
          <HomeView
            books={books}
            loading={loading}
            onSelectBook={(id) => handleSelectView("book", id)}
            onBookAdded={handleBookAdded}
          />
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
