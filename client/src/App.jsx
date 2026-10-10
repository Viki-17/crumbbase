import { useState, useCallback } from "react";
import { Toaster } from "react-hot-toast";
import { LibraryBig, Search, Tags, Network } from "lucide-react";
import Library from "./views/Library.jsx";
import SourceView from "./views/SourceView.jsx";
import SearchView from "./views/SearchView.jsx";
import ConceptsView from "./views/ConceptsView.jsx";
import ConceptView from "./views/ConceptView.jsx";
import GraphView from "./views/GraphView.jsx";
import "./index.css";

// Crumbbase shell: library / source / search / concepts / graph.
export default function App() {
  const [route, setRoute] = useState({ view: "library" });
  const go = useCallback((r) => {
    setRoute(r);
    window.scrollTo(0, 0);
  }, []);
  const isActive = (v) =>
    v === "library"
      ? route.view === "library" || route.view === "source"
      : v === "concepts"
        ? route.view === "concepts" || route.view === "concept"
        : route.view === v;

  return (
    <div className="app">
      <Toaster position="bottom-center" containerStyle={{ bottom: 76 }} />
      <aside className="sidebar">
        <div className="brand">
          Crumb<span>base</span>
        </div>
        <button
          className={`nav-btn${route.view === "library" || route.view === "source" ? " active" : ""}`}
          onClick={() => go({ view: "library" })}
        >
          <LibraryBig size={18} /> Library
        </button>
        <button
          className={`nav-btn${route.view === "search" ? " active" : ""}`}
          onClick={() => go({ view: "search", q: "" })}
        >
          <Search size={18} /> Search
        </button>
        <button
          className={`nav-btn${route.view === "concepts" || route.view === "concept" ? " active" : ""}`}
          onClick={() => go({ view: "concepts" })}
        >
          <Tags size={18} /> Concepts
        </button>
        <button
          className={`nav-btn${route.view === "graph" ? " active" : ""}`}
          onClick={() => go({ view: "graph" })}
        >
          <Network size={18} /> Graph
        </button>
        <div className="sidebar-foot">
          <a
            href="/api/setup/status"
            target="_blank"
            rel="noreferrer"
          >
            setup status
          </a>
        </div>
      </aside>
      {/* Mobile top bar + bottom tab bar (CSS shows only on small screens) */}
      <header className="mobile-topbar">
        <span className="brand">
          Crumb<span>base</span>
        </span>
      </header>
      <nav className="mobile-nav" aria-label="Primary">
        <button className={`tab${isActive("library") ? " active" : ""}`} onClick={() => go({ view: "library" })}>
          <LibraryBig size={20} />
          <span>Library</span>
        </button>
        <button className={`tab${isActive("search") ? " active" : ""}`} onClick={() => go({ view: "search", q: "" })}>
          <Search size={20} />
          <span>Search</span>
        </button>
        <button className={`tab${isActive("concepts") ? " active" : ""}`} onClick={() => go({ view: "concepts" })}>
          <Tags size={20} />
          <span>Concepts</span>
        </button>
        <button className={`tab${isActive("graph") ? " active" : ""}`} onClick={() => go({ view: "graph" })}>
          <Network size={20} />
          <span>Graph</span>
        </button>
      </nav>
      <main className="main">
        {route.view === "library" && <Library go={go} />}
        {route.view === "source" && <SourceView key={route.id} id={route.id} go={go} />}
        {route.view === "search" && <SearchView key={route.q || "s"} initial={route.q || ""} go={go} />}
        {route.view === "concepts" && <ConceptsView go={go} />}
        {route.view === "concept" && <ConceptView key={route.id} id={route.id} go={go} />}
        {route.view === "graph" && <GraphView go={go} />}
      </main>
    </div>
  );
}
