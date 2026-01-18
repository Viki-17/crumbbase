import React, { useState } from "react";
import api from "../api";
import { Trash2 } from "lucide-react";

const NoteCard = ({
  note,
  onUpdate,
  onDeleteNote,
  isSelected,
  onSelect,
  linkedCount,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(note.title);
  const [editedContent, setEditedContent] = useState(note.content);
  const [editedTags, setEditedTags] = useState(note.tags?.join(", ") || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (e) => {
    e.stopPropagation();
    setIsSaving(true);
    try {
      const tagsArray = editedTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await api.patch(`/notes/${note.id}`, {
        title: editedTitle,
        content: editedContent,
        tags: tagsArray,
      });
      setIsEditing(false);
      if (onUpdate) onUpdate(res.data);
    } catch (err) {
      alert("Failed to save note: " + err.message);
    }
    setIsSaving(false);
  };

  const handleCancel = (e) => {
    e.stopPropagation();
    setEditedTitle(note.title);
    setEditedContent(note.content);
    setEditedTags(note.tags?.join(", ") || "");
    setIsEditing(false);
  };

  const toggleEdit = (e) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  if (isEditing) {
    return (
      <div className="card note-card editing" style={{ cursor: "default" }}>
        <input
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          placeholder="Title"
          className="edit-input"
          style={{ width: "100%", marginBottom: "0.75rem" }}
        />
        <textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          placeholder="Content"
          className="edit-textarea"
          rows={6}
          style={{ width: "100%", marginBottom: "0.75rem" }}
        />
        <input
          value={editedTags}
          onChange={(e) => setEditedTags(e.target.value)}
          placeholder="Tags (comma separated)"
          className="edit-input"
          style={{ width: "100%", marginBottom: "1rem" }}
        />
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-small"
            style={{ background: "var(--primary-color)" }}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handleCancel}
            className="btn-small"
            style={{
              background: "transparent",
              border: "1px solid var(--border-color)",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onSelect}
      className={`card note-card ${isSelected ? "selected" : ""}`}
      style={{
        cursor: "pointer",
        position: "relative",
        border: isSelected
          ? "2px solid var(--accent-color)"
          : "1px solid var(--border-color)",
        background: isSelected ? "rgba(99, 102, 241, 0.1)" : "var(--card-bg)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <h4
          style={{
            margin: "0 0 0.5rem 0",
            color: "var(--accent-color)",
            paddingRight: "40px",
          }}
        >
          {note.title}
        </h4>
        <button
          onClick={toggleEdit}
          className="edit-btn"
          style={{
            position: "absolute",
            top: "0.5rem",
            right: "0.5rem",
            background: "transparent",
            padding: "4px 8px",
            fontSize: "0.8rem",
            border: "1px solid var(--border-color)",
            opacity: 0.6,
          }}
        >
          Edit
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            console.log(
              "Delete clicked. onDeleteNote type:",
              typeof onDeleteNote
            );
            if (typeof onDeleteNote === "function") {
              onDeleteNote(note.id);
            } else {
              console.error("onDeleteNote is not a function:", onDeleteNote);
            }
          }}
          className="delete-btn"
          style={{
            position: "absolute",
            top: "0.5rem",
            right: "3.5rem",
            background: "transparent",
            padding: "4px 8px",
            fontSize: "0.8rem",
            border: "1px solid #ef4444",
            color: "#ef4444",
            opacity: 0.6,
            borderRadius: "4px",
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <p style={{ fontSize: "0.9rem", opacity: 0.9, marginBottom: "0.5rem" }}>
        {note.content}
      </p>
      <div style={{ fontSize: "0.8rem", opacity: 0.6 }}>
        {note.tags?.map((t) => (
          <span key={t} style={{ marginRight: "5px" }}>
            #{t}
          </span>
        ))}
      </div>
      {linkedCount > 0 && (
        <div
          style={{
            marginTop: "0.5rem",
            fontSize: "0.8rem",
            color: "var(--primary-color)",
          }}
        >
          🔗 {linkedCount} links
        </div>
      )}
    </div>
  );
};

export default NoteCard;
