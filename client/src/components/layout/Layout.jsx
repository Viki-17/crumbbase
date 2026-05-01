import React, { useState } from "react";
import { PanelRightOpen, Menu, BookMarked } from "lucide-react";
import Sidebar from "./Sidebar";
import ContextPanel from "./ContextPanel";
import "./../../styles/layout.css";

/**
 * Layout - Main 3-pane container
 *
 * Structure:
 * [Sidebar] [Main Content] [Context Panel]
 *
 * Props:
 * - children: Main content area
 * - selectedNote: Currently selected note (for context panel)
 * - onSelectView: Callback when navigation changes
 */
const Layout = ({
  children,
  selectedNote = null,
  selectedBook = null,
  onSelectView,
  books = [],
}) => {
  const [contextPanelVisible, setContextPanelVisible] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div
      className={`layout ${!contextPanelVisible ? "context-panel-hidden" : ""}`}
    >
      {/* Mobile Header */}
      <div className="mobile-header">
        <button
          className="mobile-menu-toggle"
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        >
          <Menu size={18} />
        </button>
        <BookMarked size={16} style={{ color: "var(--primary)", flexShrink: 0 }} />
        <span className="mobile-brand">CrumbBase</span>
      </div>

      {/* Mobile Overlay */}
      {mobileSidebarOpen && (
        <div
          className="mobile-sidebar-overlay"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <div
        className={`sidebar-container ${
          mobileSidebarOpen ? "mobile-visible" : ""
        }`}
      >
        <Sidebar
          onSelectView={(view, id) => {
            onSelectView(view, id);
            setMobileSidebarOpen(false); // Close on selection
          }}
          selectedNote={selectedNote}
          selectedBook={selectedBook}
          books={books}
        />
      </div>

      <main className="main-content">{children}</main>

      {contextPanelVisible ? (
        <ContextPanel
          selectedNote={selectedNote}
          selectedBook={selectedBook}
          onClose={() => setContextPanelVisible(false)}
          onNavigate={onSelectView}
        />
      ) : (
        <button
          onClick={() => setContextPanelVisible(true)}
          className="btn-ghost"
          style={{
            position: "fixed",
            right: "16px",
            top: "16px",
            zIndex: 100,
            padding: "8px",
            borderRadius: "var(--border-radius-sm)",
            width: "36px",
            height: "36px",
            minHeight: "36px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--glass-bg)",
            backdropFilter: "var(--glass-blur)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid var(--glass-border)",
          }}
          title="Show Context Panel"
        >
          <PanelRightOpen size={16} />
        </button>
      )}
    </div>
  );
};

export default Layout;
