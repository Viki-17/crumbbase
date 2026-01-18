import React, { useState, useEffect } from "react";
import api from "../../api";
import {
  BookOpen,
  FileText,
  Folder,
  Network,
  Activity,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import "./../../styles/sidebar.css";

/**
 * Sidebar - Left navigation panel
 *
 * Sections:
 * - Library (books)
 * - Notes (all atomic notes)
 * - Folders (AI-organized)
 * - Graph (visualization toggle)
 * - Processing (status indicator)
 */
const Sidebar = ({ onSelectView, selectedNote, selectedBook, books = [] }) => {
  const [notesCount, setNotesCount] = useState(0);
  const [foldersCount, setFoldersCount] = useState(0);
  const [processingCount, setProcessingCount] = useState(0);

  const [sections, setSections] = useState({
    library: true,
    notes: false,
    folders: false,
    processing: false,
  });

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    // Count processing books
    const processing = books.filter((b) => b.status === "processing").length;
    setProcessingCount(processing);
  }, [books]);

  const fetchData = async () => {
    try {
      const [notesRes, foldersRes] = await Promise.all([
        api.get("/notes"),
        api.get("/folders"),
      ]);

      setNotesCount(notesRes.data.length);
      setFoldersCount(foldersRes.data.folders?.length || 0);
    } catch (err) {
      console.error("Sidebar data fetch error:", err);
    }
  };

  const toggleSection = (section) => {
    setSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title" onClick={() => onSelectView("home")}>
          📚 CrumbBase
        </div>
      </div>

      <div className="sidebar-content">
        {/* Library Section */}
        <div
          className={`sidebar-section ${sections.library ? "" : "collapsed"}`}
        >
          <div
            className="sidebar-section-header"
            onClick={() => toggleSection("library")}
          >
            <div className="sidebar-section-title">
              <BookOpen size={14} />
              <span>Library</span>
            </div>
            {sections.library ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </div>
          <div className="sidebar-section-content">
            {books.map((book) => (
              <div
                key={book.id}
                className={`sidebar-item ${
                  selectedBook?.id === book.id ? "active" : ""
                }`}
                onClick={() => onSelectView("book", book.id)}
              >
                <BookOpen className="sidebar-item-icon" size={16} />
                <span className="sidebar-item-text">{book.title}</span>
                {book.status === "processing" && (
                  <span className="sidebar-item-badge">⏳</span>
                )}
              </div>
            ))}
            {books.length === 0 && (
              <div
                className="sidebar-item"
                style={{ color: "var(--text-tertiary)", cursor: "default" }}
              >
                No books yet
              </div>
            )}
          </div>
        </div>

        {/* Notes Section */}
        <div className={`sidebar-section ${sections.notes ? "" : "collapsed"}`}>
          <div
            className="sidebar-section-header"
            onClick={() => toggleSection("notes")}
          >
            <div className="sidebar-section-title">
              <FileText size={14} />
              <span>Notes</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {notesCount > 0 && (
                <span className="sidebar-item-badge">{notesCount}</span>
              )}
              {sections.notes ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </div>
          </div>
          <div className="sidebar-section-content">
            <div className="sidebar-item" onClick={() => onSelectView("notes")}>
              <FileText className="sidebar-item-icon" size={16} />
              <span className="sidebar-item-text">All Notes</span>
            </div>
          </div>
        </div>

        {/* Folders Section */}
        <div
          className={`sidebar-section ${sections.folders ? "" : "collapsed"}`}
        >
          <div
            className="sidebar-section-header"
            onClick={() => toggleSection("folders")}
          >
            <div className="sidebar-section-title">
              <Folder size={14} />
              <span>Folders</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {foldersCount > 0 && (
                <span className="sidebar-item-badge">{foldersCount}</span>
              )}
              {sections.folders ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </div>
          </div>
          <div className="sidebar-section-content">
            <div
              className="sidebar-item"
              onClick={() => onSelectView("folders")}
            >
              <Folder className="sidebar-item-icon" size={16} />
              <span className="sidebar-item-text">AI-Organized</span>
            </div>
          </div>
        </div>

        {/* Graph View */}
        <div className="sidebar-section">
          <div className="sidebar-item" onClick={() => onSelectView("graph")}>
            <Network className="sidebar-item-icon" size={16} />
            <span className="sidebar-item-text">Graph View</span>
          </div>
        </div>

        {/* Processing Status */}
        {processingCount > 0 && (
          <div className="sidebar-section">
            <div
              className="sidebar-item"
              onClick={() => onSelectView("processing")}
            >
              <Activity className="sidebar-item-icon" size={16} />
              <span className="sidebar-item-text">Processing</span>
              <span className="sidebar-item-badge">{processingCount}</span>
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-footer">v8.0 - Modern UI</div>
    </div>
  );
};

export default Sidebar;
