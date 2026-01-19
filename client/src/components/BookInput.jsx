import React, { useState } from "react";
import api from "../api";

const BookInput = ({ onBookAdded }) => {
  const [mode, setMode] = useState("pdf"); // 'pdf' or 'transcript'
  const [file, setFile] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [bookType, setBookType] = useState("nonfiction"); // 'fiction' or 'nonfiction'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (selected.type !== "application/pdf") {
        setError("Please select a PDF file.");
        return;
      }
      // (Removed file size check)
      setFile(selected);
      setError(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();

      if (mode === "pdf") {
        if (!file) {
          setError("Please select a PDF file.");
          setLoading(false);
          return;
        }
        formData.append("file", file);
        formData.append("bookType", bookType);
      } else {
        if (!transcript.trim()) {
          setError("Please paste a transcript.");
          setLoading(false);
          return;
        }
        // For transcript, we can send as JSON or FormData.
        // Backend handles multipart/form-data for file, and JSON for transcript if we separate routes or logic?
        // Wait, backend logic:
        // app.post("/api/books", upload.single("file"), ...)
        // If we send JSON, multer middleware might not process body if header isn't multipart?
        // Multer processes `multipart/form-data`. If we send JSON `application/json`, multer might skip?
        // Actually, for JSON body, we should probably just send JSON and `upload.single` will just ignore file field if checking `req.file` correctly.
        // BUT `req.body` might be empty if content-type is json and body-parser isn't used before multer?
        // `app.use(bodyParser.json())` is in index.js at top.
        // So sending JSON for transcript is fine.
      }

      let response;
      if (mode === "pdf") {
        response = await api.post("/books", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        response = await api.post("/books", { transcript, bookType });
      }

      onBookAdded(response.data.id);

      // Reset
      setFile(null);
      setTranscript("");
      setBookType("nonfiction");
      // Reset file input value if possible, or just re-render
      document.getElementById("pdf-upload").value = "";
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Failed to add book");
    } finally {
      setLoading(false);
    }
  };

  const tabStyle = (active) => ({
    padding: "8px 16px",
    cursor: "pointer",
    color: active ? "var(--text-color)" : "var(--text-muted)",
    fontWeight: active ? "bold" : "normal",
    background: "none",
    border: "none",
    borderBottom: active
      ? "2px solid var(--primary-color)"
      : "2px solid transparent",
    marginBottom: "10px",
  });

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          gap: "10px",
          marginBottom: "15px",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        <button
          type="button"
          onClick={() => setMode("pdf")}
          style={tabStyle(mode === "pdf")}
        >
          📄 Upload PDF
        </button>
        <button
          type="button"
          onClick={() => setMode("transcript")}
          style={tabStyle(mode === "transcript")}
        >
          📝 Paste Transcript
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="input-group"
        style={{ flexDirection: "column", alignItems: "stretch" }}
      >
        {mode === "pdf" ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
              Select a PDF file (max 5MB).
            </p>
            <input
              id="pdf-upload"
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              style={{
                padding: "10px",
                border: "1px dashed var(--border-color)",
                borderRadius: "4px",
              }}
            />
          </div>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
              Paste the full text or transcript below.
            </p>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Paste transcript here..."
              rows={6}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "4px",
                border: "1px solid var(--border-color)",
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
          </div>
        )}

        {/* Book Type Selector */}
        <div
          style={{
            marginTop: "15px",
            padding: "12px",
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            background: "var(--bg-secondary)",
          }}
        >
          <p
            style={{
              fontSize: "0.85rem",
              fontWeight: "bold",
              marginBottom: "10px",
              color: "var(--text-color)",
            }}
          >
            📚 Book Type
          </p>
          <div style={{ display: "flex", gap: "20px" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="bookType"
                value="nonfiction"
                checked={bookType === "nonfiction"}
                onChange={(e) => setBookType(e.target.value)}
              />
              <span>📖 Non-Fiction</span>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="bookType"
                value="fiction"
                checked={bookType === "fiction"}
                onChange={(e) => setBookType(e.target.value)}
              />
              <span>✨ Fiction</span>
            </label>
          </div>
        </div>

        <div
          style={{
            marginTop: "15px",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="submit"
            disabled={
              loading ||
              (mode === "pdf" && !file) ||
              (mode === "transcript" && !transcript.trim())
            }
          >
            {loading
              ? "Processing..."
              : mode === "pdf"
              ? "Upload & Process"
              : "Process Transcript"}
          </button>
        </div>
      </form>
      {error && <p style={{ color: "#ef4444", marginTop: "1rem" }}>{error}</p>}
    </div>
  );
};

export default BookInput;
