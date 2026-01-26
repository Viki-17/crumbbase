import React, { useState, useEffect } from "react";
import BookInput from "../BookInput";
import { Search, Book, Youtube, PenTool, LayoutGrid } from "lucide-react";
import Loading from "../layout/Loading";

const HomeView = ({ books, loading, onSelectBook, onBookAdded }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all"); // 'all', 'book', 'youtube', 'blog'
  const [activeGenre, setActiveGenre] = useState("all"); // 'all', 'fiction', 'nonfiction'

  // Filter Logic
  const filteredBooks = books.filter((book) => {
    // 1. Search Filter
    const matchesSearch = book.title
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    // 2. Category Filter
    // Note: server/index.js sets type="book" for all, but we added sourceType to schema.
    // However, existing data might not have sourceType set correctly (null for books).
    // Logic:
    // - Book: sourceType == null || sourceType == undefined || sourceType == 'pdf'
    // - YouTube: sourceType == 'youtube'
    // - Blog: sourceType == 'blog'

    let matchesCategory = true;
    if (activeCategory === "book") {
      matchesCategory = !book.sourceType || book.sourceType === "pdf";
    } else if (activeCategory === "youtube") {
      matchesCategory = book.sourceType === "youtube";
    } else if (activeCategory === "blog") {
      matchesCategory = book.sourceType === "blog";
    }

    if (!matchesCategory) return false;

    // 3. Genre Filter (Only if looking at books or All)
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
  });

  // Calculate counts for badges
  const getCount = (category, genre = "all") => {
    return books.filter((b) => {
      let matchCat = true;
      if (category === "book")
        matchCat = !b.sourceType || b.sourceType === "pdf";
      else if (category === "youtube") matchCat = b.sourceType === "youtube";
      else if (category === "blog") matchCat = b.sourceType === "blog";

      if (!matchCat) return false;

      if (category === "book" && genre !== "all") {
        return b.bookType === genre;
      }
      return true;
    }).length;
  };

  const categories = [
    { id: "all", label: "All", icon: LayoutGrid, count: books.length },
    { id: "book", label: "Books", icon: Book, count: getCount("book") },
    {
      id: "youtube",
      label: "YouTube",
      icon: Youtube,
      count: getCount("youtube"),
    },
    { id: "blog", label: "Articles", icon: PenTool, count: getCount("blog") },
  ];

  return (
    <div
      className="container"
      style={{ padding: "var(--space-xl)", maxWidth: "1200px" }}
    >
      {/* Header Section */}
      <div style={{ marginBottom: "2rem" }}>
        <BookInput onBookAdded={onBookAdded} />
      </div>

      {/* Search and Filter Bar */}
      <div
        className="flex-between"
        style={{
          marginBottom: "2rem",
          gap: "1rem",
          flexWrap: "wrap",
          padding: "1rem",
          background: "var(--bg-card)",
          borderRadius: "12px",
          border: "1px solid var(--border-color)",
        }}
      >
        {/* Search */}
        <div style={{ position: "relative", flex: "1", minWidth: "240px" }}>
          <Search
            size={18}
            style={{
              position: "absolute",
              left: "12px",
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
              padding: "10px 10px 10px 40px",
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              background: "var(--bg-main)",
              color: "var(--text-primary)",
              fontSize: "0.95rem",
            }}
          />
        </div>

        {/* Categories */}
        <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto" }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "8px",
                background:
                  activeCategory === cat.id
                    ? "var(--primary-color)"
                    : "transparent",
                color:
                  activeCategory === cat.id ? "#fff" : "var(--text-secondary)",
                border:
                  activeCategory === cat.id
                    ? "1px solid var(--primary-color)"
                    : "1px solid transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontSize: "0.9rem",
                fontWeight: "500",
                transition: "all 0.2s",
              }}
              onMouseOver={(e) => {
                if (activeCategory !== cat.id)
                  e.currentTarget.style.background = "var(--bg-surface-2)";
              }}
              onMouseOut={(e) => {
                if (activeCategory !== cat.id)
                  e.currentTarget.style.background = "transparent";
              }}
            >
              <cat.icon size={16} />
              {cat.label}
              {cat.count > 0 && (
                <span
                  style={{ opacity: 0.7, fontSize: "0.8em", marginLeft: "4px" }}
                >
                  {cat.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-Filters for Books */}
      {activeCategory === "book" && (
        <div style={{ marginBottom: "1.5rem", display: "flex", gap: "1rem" }}>
          <span
            style={{
              fontSize: "0.9rem",
              color: "var(--text-secondary)",
              alignSelf: "center",
            }}
          >
            Type:
          </span>
          {["all", "nonfiction", "fiction"].map((genre) => (
            <button
              key={genre}
              onClick={() => setActiveGenre(genre)}
              style={{
                padding: "4px 12px",
                borderRadius: "16px",
                fontSize: "0.85rem",
                background:
                  activeGenre === genre ? "var(--bg-surface-3)" : "transparent",
                color:
                  activeGenre === genre
                    ? "var(--text-primary)"
                    : "var(--text-tertiary)",
                border:
                  activeGenre === genre
                    ? "1px solid var(--border-color)"
                    : "1px solid transparent",
                cursor: "pointer",
              }}
            >
              {genre === "all"
                ? "All Types"
                : genre === "nonfiction"
                  ? "Non-Fiction"
                  : "Fiction"}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <Loading message="Fetching your library..." />
      ) : filteredBooks.length === 0 ? (
        <div
          className="text-secondary"
          style={{
            textAlign: "center",
            padding: "4rem 2rem",
            background: "var(--bg-surface-1)",
            borderRadius: "12px",
            border: "1px dashed var(--border-color)",
          }}
        >
          {searchQuery ? (
            <>
              <h3>No matches found</h3>
              <p>Try adjusting your search or filters.</p>
            </>
          ) : (
            <>
              <h3>Library is empty</h3>
              <p>Add a book, article, or video above to get started.</p>
            </>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: "1.5rem",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          }}
        >
          {filteredBooks.map((book) => (
            <div
              key={book.id}
              onClick={() => onSelectBook(book.id)}
              className="card book-card"
              style={{
                cursor: "pointer",
                transition: "all 0.2s ease",
                position: "relative",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = "translateY(-4px)";
                e.currentTarget.style.borderColor = "var(--primary-color)";
                e.currentTarget.style.boxShadow = "var(--shadow-lg)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.borderColor = "var(--border-color)";
                e.currentTarget.style.boxShadow = "var(--shadow-sm)";
              }}
            >
              <div
                className="flex-between"
                style={{ alignItems: "flex-start", marginBottom: "auto" }}
              >
                <div style={{ display: "flex", gap: "10px" }}>
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "8px",
                      background:
                        book.sourceType === "youtube"
                          ? "#ff000015"
                          : book.sourceType === "blog"
                            ? "#3b82f615"
                            : "var(--bg-surface-2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color:
                        book.sourceType === "youtube"
                          ? "red"
                          : book.sourceType === "blog"
                            ? "#3b82f6"
                            : "var(--text-secondary)",
                    }}
                  >
                    {book.sourceType === "youtube" ? (
                      <Youtube size={20} />
                    ) : book.sourceType === "blog" ? (
                      <PenTool size={20} />
                    ) : (
                      <Book size={20} />
                    )}
                  </div>
                  <div>
                    <h3
                      className="truncate-2" // Assuming truncate-2 class exists, else standard CSS
                      style={{
                        fontSize: "1.1rem",
                        margin: "0 0 0.25rem 0",
                        color: "var(--text-primary)",
                        lineHeight: "1.4",
                      }}
                      title={book.title}
                    >
                      {book.title}
                    </h3>
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-tertiary)",
                      }}
                    >
                      {book.bookType === "fiction"
                        ? "Fiction"
                        : book.bookType === "nonfiction"
                          ? "Non-Fiction"
                          : "Unknown"}
                    </span>
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: "1rem",
                  paddingTop: "1rem",
                  borderTop: "1px solid var(--border-color)",
                }}
              >
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HomeView;
