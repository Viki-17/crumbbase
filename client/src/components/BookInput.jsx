import React, { useState } from "react";
import axios from "axios";

const BookInput = ({ onBookAdded }) => {
  const [filePath, setFilePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handlePickFile = async () => {
    try {
      const res = await axios.get("/api/system/pick-file");
      if (res.data.filePath) {
        setFilePath(res.data.filePath);
      }
    } catch (err) {
      console.error("Failed to pick file", err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!filePath.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const response = await axios.post("/api/books", { filePath });
      onBookAdded(response.data.id);
      setFilePath("");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add book");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Add New Book</h2>
      <form onSubmit={handleSubmit} className="input-group">
        <div style={{ display: "flex", gap: "10px", flex: 1 }}>
          <button
            type="button"
            onClick={handlePickFile}
            style={{
              background: "var(--secondary-color)",
              whiteSpace: "nowrap",
            }}
          >
            📂 Select File
          </button>
          <input
            type="text"
            placeholder="Absolute path to PDF"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "Processing..." : "Add Book"}
        </button>
      </form>
      {error && (
        <p style={{ color: "#ef4444", marginTop: "0.5rem" }}>{error}</p>
      )}
    </div>
  );
};

export default BookInput;
