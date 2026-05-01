import React, { useState } from "react";
import api from "../api";
import { Upload, FileText, BookOpen, Sparkles, Youtube, PenLine, File } from "lucide-react";

const BookInput = ({ onBookAdded }) => {
  const [mode, setMode] = useState("pdf");
  const [file, setFile] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("youtube");
  const [bookType, setBookType] = useState("nonfiction");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (selected.type !== "application/pdf") {
        setError("Please select a PDF file.");
        return;
      }
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
        if (!title.trim()) {
          setError("Please enter a title.");
          setLoading(false);
          return;
        }
      }

      let response;
      if (mode === "pdf") {
        response = await api.post("/books", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        response = await api.post("/books", {
          transcript,
          title,
          sourceType,
        });
      }

      onBookAdded(response.data.id);

      setFile(null);
      setTranscript("");
      setTitle("");
      setBookType("nonfiction");
      document.getElementById("pdf-upload").value = "";
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Failed to add book");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div
        className="flex-between"
        style={{
          marginBottom: "1.25rem",
          justifyContent: "flex-start",
          gap: "0.5rem",
        }}
      >
        <button
          type="button"
          onClick={() => setMode("pdf")}
          className={mode === "pdf" ? "btn-primary" : "btn-ghost"}
        >
          <Upload size={14} /> Upload PDF
        </button>
        <button
          type="button"
          onClick={() => setMode("transcript")}
          className={mode === "transcript" ? "btn-primary" : "btn-ghost"}
        >
          <FileText size={14} /> Paste Transcript
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ width: "100%" }}>
        {mode === "pdf" ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <p className="text-secondary" style={{ fontSize: "var(--font-size-sm)" }}>
              Select a PDF file (max 5MB).
            </p>
            <input
              id="pdf-upload"
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              style={{
                padding: "1.5rem",
                border: "1px dashed var(--border-hover)",
                background: "var(--bg-surface-2)",
                borderRadius: "var(--border-radius-sm)",
                cursor: "pointer",
                width: "100%",
                textAlign: "center",
                fontSize: "var(--font-size-sm)",
              }}
            />

            <div
              style={{
                background: "var(--bg-surface-2)",
                padding: "1rem",
                borderRadius: "var(--border-radius-sm)",
                border: "1px solid var(--border-color)",
                width: "100%",
              }}
            >
              <p
                style={{
                  fontWeight: "500",
                  marginBottom: "0.6rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  fontSize: "var(--font-size-sm)",
                }}
              >
                <BookOpen size={14} style={{ color: "var(--primary)", opacity: 0.7 }} /> Book Type
              </p>
              <div style={{ display: "flex", gap: "1.5rem" }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    cursor: "pointer",
                    fontSize: "var(--font-size-sm)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <input
                    type="radio"
                    name="bookType"
                    value="nonfiction"
                    checked={bookType === "nonfiction"}
                    onChange={(e) => setBookType(e.target.value)}
                    style={{ width: "auto" }}
                  />
                  <span>Non-Fiction</span>
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    cursor: "pointer",
                    fontSize: "var(--font-size-sm)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <input
                    type="radio"
                    name="bookType"
                    value="fiction"
                    checked={bookType === "fiction"}
                    onChange={(e) => setBookType(e.target.value)}
                    style={{ width: "auto" }}
                  />
                  <Sparkles size={12} style={{ opacity: 0.6 }} />
                  <span>Fiction</span>
                </label>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "0.4rem",
                  fontWeight: "500",
                  fontSize: "var(--font-size-sm)",
                }}
              >
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. My Transcript Name"
                style={{ width: "100%" }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "0.4rem",
                  fontWeight: "500",
                  fontSize: "var(--font-size-sm)",
                }}
              >
                Source Type
              </label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="youtube">YouTube</option>
                <option value="blog">Blog / Article</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "0.4rem",
                  fontWeight: "500",
                  fontSize: "var(--font-size-sm)",
                }}
              >
                Transcript
              </label>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Paste transcript here..."
                rows={8}
                style={{
                  resize: "vertical",
                  minHeight: "120px",
                  width: "100%",
                }}
              />
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: "1.5rem",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="submit"
            className="btn-primary"
            style={{ padding: "0.5rem 1.5rem" }}
            disabled={
              loading ||
              (mode === "pdf" && !file) ||
              (mode === "transcript" && (!transcript.trim() || !title.trim()))
            }
          >
            {loading ? (
              <>Processing...</>
            ) : mode === "pdf" ? (
              <>Upload & Process</>
            ) : (
              <>Process Transcript</>
            )}
          </button>
        </div>
      </form>
      {error && (
        <div
          style={{
            color: "var(--error)",
            marginTop: "0.75rem",
            padding: "0.5rem 0.75rem",
            background: "var(--error-bg)",
            borderRadius: "var(--border-radius-sm)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
};

export default BookInput;
