import React, { useState } from "react";
import { PanelRightOpen } from "lucide-react";
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

  return (
    <div
      className={`layout ${!contextPanelVisible ? "context-panel-hidden" : ""}`}
    >
      <Sidebar
        onSelectView={onSelectView}
        selectedNote={selectedNote}
        selectedBook={selectedBook}
        books={books}
      />

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
