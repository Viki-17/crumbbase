import React, { useState, useMemo } from "react";
import BookInput from "../BookInput";
import { Search, Book, Youtube, PenTool, LayoutGrid, Clock, CheckCircle2 } from "lucide-react";
import Loading from "../layout/Loading";

const HomeView = ({ books, loading, onSelectBook, onBookAdded }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeGenre, setActiveGenre] = useState("all");

  // Filter Logic
  const filteredBooks = useMemo(
    () =>
      books.filter((book) => {
        const matchesSearch = book.title
          .toLowerCase()
          .includes(searchQuery.toLowerCase());
        if (!matchesSearch) return false;

        let matchesCategory = true;
        if (activeCategory === "book") {
          matchesCategory = !book.sourceType || book.sourceType === "pdf";
        } else if (activeCategory === "youtube") {
          matchesCategory = book.sourceType === "youtube";
        } else if (activeCategory === "blog") {
          matchesCategory = book.sourceType === "blog";
        }
        if (!matchesCategory) return false;

        if (
          activeCategory === "book" ||
          (activeCategory === "all" &&
            (!book.sourceType || book.sourceType === "pdf"))
        ) {
          if (activeGenre !== "all") {
            if (book.bookType !== activeGenre) return false;
          }
        }
        return true;
      }),
    [books, searchQuery, activeCategory, activeGenre],
  );

  // Compute category counts in a single pass instead of 4 separate filters
  const categoryCounts = useMemo(() => {
    let book = 0;
    let youtube = 0;
    let blog = 0;
    for (const b of books) {
      if (b.sourceType === "youtube") youtube++;
      else if (b.sourceType === "blog") blog++;
      else if (!b.sourceType || b.sourceType === "pdf") book++;
    }
    return { book, youtube, blog };
  }, [books]);

  const categories = [
    { id: "all", label: "All", icon: LayoutGrid, count: books.length },
    { id: "book", label: "Books", icon: Book, count: categoryCounts.book },
    { id: "youtube", label: "YouTube", icon: Youtube, count: categoryCounts.youtube },
    { id: "blog", label: "Articles", icon: PenTool, count: categoryCounts.blog },
  ];

  const getSourceColor = (sourceType) => {
    if (sourceType === "youtube") return { bg: "rgba(239, 68, 68, 0.08)", color: "#ef4444", border: "rgba(239, 68, 68, 0.15)" };
    if (sourceType === "blog") return { bg: "rgba(56, 189, 248, 0.08)", color: "#38bdf8", border: "rgba(56, 189, 248, 0.15)" };
    return { bg: "var(--primary-light)", color: "var(--primary)", border: "rgba(139, 92, 246, 0.15)" };
  };

  return (
    <div
      className="container"
      style={{ padding: "var(--space-xl)", maxWidth: "1200px" }}
    >
      {/* Header Section */}
      <div style={{ marginBottom: "1.5rem" }}>
        <BookInput onBookAdded={onBookAdded} />
      </div>

      {/* Search and Filter Bar */}
      <div
        style={{
          marginBottom: "1.5rem",
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          alignItems: "center",
          padding: "0.75rem",
          background: "var(--bg-surface-1)",
          borderRadius: "var(--border-radius)",
          border: "1px solid var(--border-color)",
        }}
      >
        {/* Search */}
        <div style={{ position: "relative", flex: "1", minWidth: "200px" }}>
          <Search
            size={15}
            style={{
              position: "absolute",
              left: "10px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-tertiary)",
            }}
          />
          <input
            type="text"
            placeholder="Search your library..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 8px 8px 34px",
              borderRadius: "var(--border-radius-sm)",
              border: "1px solid var(--border-color)",
              background: "var(--bg-surface-2)",
              color: "var(--text-primary)",
              fontSize: "var(--font-size-sm)",
            }}
          />
        </div>

        {/* Categories */}
        <div style={{ display: "flex", gap: "3px", overflowX: "auto" }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={activeCategory === cat.id ? "btn-primary" : "btn-ghost"}
              style={{
                padding: "6px 12px",
                fontSize: "var(--font-size-xs)",
                whiteSpace: "nowrap",
              }}
            >
              <cat.icon size={13} />
              {cat.label}
              {cat.count > 0 && (
                <span style={{ opacity: 0.6, fontSize: "0.7em", marginLeft: "2px" }}>
                  {cat.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-Filters for Books */}
      {activeCategory === "book" && (
        <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)" }}>
            Type:
          </span>
          {["all", "nonfiction", "fiction"].map((genre) => (
            <button
              key={genre}
              onClick={() => setActiveGenre(genre)}
              className={activeGenre === genre ? "btn-primary" : "btn-ghost"}
              style={{
                padding: "3px 10px",
                fontSize: "var(--font-size-xs)",
              }}
            >
              {genre === "all" ? "All" : genre === "nonfiction" ? "Non-Fiction" : "Fiction"}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <Loading message="Fetching your library..." />
      ) : filteredBooks.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem 2rem",
            background: "var(--bg-surface-1)",
            borderRadius: "var(--border-radius)",
            border: "1px dashed var(--border-color)",
          }}
        >
          {searchQuery ? (
            <>
              <h3 style={{ fontSize: "var(--font-size-base)", marginBottom: "0.25rem" }}>No matches found</h3>
              <p className="text-secondary" style={{ fontSize: "var(--font-size-sm)" }}>Try adjusting your search or filters.</p>
            </>
          ) : (
            <>
              <h3 style={{ fontSize: "var(--font-size-base)", marginBottom: "0.25rem" }}>Library is empty</h3>
              <p className="text-secondary" style={{ fontSize: "var(--font-size-sm)" }}>Add a book, article, or video above to get started.</p>
            </>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          }}
        >
          {filteredBooks.map((book) => {
            const sourceStyle = getSourceColor(book.sourceType);
            return (
              <div
                key={book.id}
                onClick={() => onSelectBook(book.id)}
                className="card"
                style={{
                  cursor: "pointer",
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  borderLeft: `3px solid ${sourceStyle.color}`,
                }}
              >
                <div style={{ display: "flex", gap: "0.75rem", marginBottom: "auto" }}>
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "var(--border-radius-sm)",
                      background: sourceStyle.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: sourceStyle.color,
                      flexShrink: 0,
                    }}
                  >
                    {book.sourceType === "youtube" ? (
                      <Youtube size={16} />
                    ) : book.sourceType === "blog" ? (
                      <PenTool size={16} />
                    ) : (
                      <Book size={16} />
                    )}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h3
                      className="truncate"
                      style={{
                        fontSize: "var(--font-size-sm)",
                        margin: "0 0 0.15rem 0",
                        fontWeight: "500",
                        lineHeight: "1.3",
                      }}
                      title={book.title}
                    >
                      {book.title}
                    </h3>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: "var(--text-tertiary)",
                      }}
                    >
                      {book.bookType === "fiction" ? "Fiction" : book.bookType === "nonfiction" ? "Non-Fiction" : ""}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "0.75rem",
                    paddingTop: "0.6rem",
                    borderTop: "1px solid var(--border-color)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.65rem",
                      padding: "1px 7px",
                      borderRadius: "var(--border-radius-pill)",
                      background:
                        book.status === "done"
                          ? "var(--success-bg)"
                          : book.status === "processing"
                            ? "var(--warning-bg)"
                            : "var(--bg-surface-3)",
                      color:
                        book.status === "done"
                          ? "var(--success)"
                          : book.status === "processing"
                            ? "var(--warning)"
                            : "var(--text-tertiary)",
                      fontWeight: "500",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "3px",
                    }}
                  >
                    {book.status === "processing" ? (
                      <><Clock size={9} /> Processing</>
                    ) : book.status === "done" ? (
                      <><CheckCircle2 size={9} /> Complete</>
                    ) : (
                      book.status
                    )}
                  </span>
                  <span
                    className="text-secondary"
                    style={{ fontSize: "0.65rem" }}
                  >
                    {new Date(book.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default HomeView;
