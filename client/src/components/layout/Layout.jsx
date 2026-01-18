import React, { useState } from "react";
import { PanelRightOpen, Menu } from "lucide-react";
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
  const [contextPanelVisible, setContextPanelVisible] = useState(true);
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
          <Menu size={20} />
        </button>
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
        />
      ) : (
        <button
          onClick={() => setContextPanelVisible(true)}
          style={{
            position: "fixed",
            right: "20px",
            top: "20px",
            zIndex: 100,
            padding: "8px",
            borderRadius: "50%",
            width: "40px",
            height: "40px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--card-bg)",
            border: "1px solid var(--border-color)",
            boxShadow: "var(--shadow-lg)",
          }}
          title="Show Context Panel"
        >
          <PanelRightOpen size={20} />
        </button>
      )}
    </div>
  );
};

export default Layout;
