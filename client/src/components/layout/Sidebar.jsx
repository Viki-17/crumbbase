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
  Youtube,
  PenTool,
} from "lucide-react";
import "./../../styles/sidebar.css";
import "./../../styles/sidebar-grouping.css";

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
  }, []); // Only fetch on mount

  useEffect(() => {
    // Refresh data when relevant sections are expanded
    if (sections.notes || sections.folders) {
      fetchData();
    }
  }, [sections.notes, sections.folders]);

  useEffect(() => {
    // Count processing books
    const processing = books.filter((b) => b.status === "processing").length;
    setProcessingCount(processing);
  }, [books]);

  const fetchData = async () => {
    try {
      // Use pagination to get just the count, not all notes
      const [notesRes, foldersRes] = await Promise.all([
        api.get("/notes", { params: { page: 1, limit: 1 } }), // Just get count
        api.get("/folders"),
      ]);

      setNotesCount(notesRes.data.pagination?.total || 0);
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
            {/* Books Group */}
            {(() => {
              const fiction = books.filter(
                (b) =>
                  (!b.sourceType || b.sourceType === "pdf") &&
                  b.bookType === "fiction",
              );
              const nonfiction = books.filter(
                (b) =>
                  (!b.sourceType || b.sourceType === "pdf") &&
                  b.bookType !== "fiction",
              );
              const youtube = books.filter((b) => b.sourceType === "youtube");
              const blog = books.filter((b) => b.sourceType === "blog");

              const hasBooks = fiction.length > 0 || nonfiction.length > 0;
              const hasYoutube = youtube.length > 0;
              const hasBlog = blog.length > 0;

              if (!hasBooks && !hasYoutube && !hasBlog) {
                return (
                  <div
                    className="sidebar-item"
                    style={{ color: "var(--text-tertiary)", cursor: "default" }}
                  >
                    No items yet
                  </div>
                );
              }

              return (
                <>
                  {/* Books Sub-section */}
                  {hasBooks && (
                    <div className="sidebar-group">
                      <div className="sidebar-group-label">Books</div>
                      {fiction.length > 0 && (
                        <>
                          <div className="sidebar-subgroup-label">Fiction</div>
                          {fiction.map((book) => (
                            <SidebarItem
                              key={book.id}
                              book={book}
                              selectedBook={selectedBook}
                              onSelectView={onSelectView}
                              type="book"
                            />
                          ))}
                        </>
                      )}
                      {nonfiction.length > 0 && (
                        <>
                          {fiction.length > 0 && (
                            <div className="sidebar-subgroup-label">
                              Non-Fiction
                            </div>
                          )}
                          {nonfiction.map((book) => (
                            <SidebarItem
                              key={book.id}
                              book={book}
                              selectedBook={selectedBook}
                              onSelectView={onSelectView}
                              type="book"
                            />
                          ))}
                        </>
                      )}
                    </div>
                  )}

                  {/* YouTube Sub-section */}
                  {hasYoutube && (
                    <div className="sidebar-group">
                      <div className="sidebar-group-label">YouTube</div>
                      {youtube.map((book) => (
                        <SidebarItem
                          key={book.id}
                          book={book}
                          selectedBook={selectedBook}
                          onSelectView={onSelectView}
                          type="youtube"
                        />
                      ))}
                    </div>
                  )}

                  {/* Blog Sub-section */}
                  {hasBlog && (
                    <div className="sidebar-group">
                      <div className="sidebar-group-label">Articles</div>
                      {blog.map((book) => (
                        <SidebarItem
                          key={book.id}
                          book={book}
                          selectedBook={selectedBook}
                          onSelectView={onSelectView}
                          type="blog"
                        />
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
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

const SidebarItem = ({ book, selectedBook, onSelectView, type }) => {
  let Icon = BookOpen;
  if (type === "youtube") Icon = Youtube;
  if (type === "blog") Icon = PenTool;

  return (
    <div
      className={`sidebar-item ${selectedBook?.id === book.id ? "active" : ""}`}
      onClick={() => onSelectView("book", book.id)}
    >
      <Icon className="sidebar-item-icon" size={16} />
      <span className="sidebar-item-text truncate">{book.title}</span>
      {book.status === "processing" && (
        <span className="sidebar-item-badge">⏳</span>
      )}
    </div>
  );
};

export default Sidebar;
