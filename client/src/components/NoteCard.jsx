import React, { useState } from "react";
import api from "../api";
import { Trash2, Edit2, Check, X } from "lucide-react";

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
      <div
        className="card note-card editing"
        style={{ cursor: "default", border: "1px solid var(--primary-color)" }}
      >
        <input
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          placeholder="Title"
          style={{ width: "100%", marginBottom: "0.75rem", fontWeight: "bold" }}
        />
        <textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          placeholder="Content"
          rows={6}
          style={{ width: "100%", marginBottom: "0.75rem", resize: "vertical" }}
        />
        <input
          value={editedTags}
          onChange={(e) => setEditedTags(e.target.value)}
          placeholder="Tags (comma separated)"
          style={{ width: "100%", marginBottom: "1rem" }}
        />
        <div
          style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}
        >
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary"
            style={{ fontSize: "0.8rem", padding: "4px 8px" }}
          >
            <Check size={14} /> {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handleCancel}
            className="btn-ghost"
            style={{ fontSize: "0.8rem", padding: "4px 8px" }}
          >
            <X size={14} /> Cancel
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
        background: isSelected ? "rgba(99, 102, 241, 0.05)" : "var(--card-bg)",
        transition: "all 0.2s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "0.5rem",
        }}
      >
        <h4
          style={{
            margin: 0,
            color: "var(--accent-color)",
            paddingRight: "60px",
          }}
        >
          {note.title}
        </h4>

        <div
          style={{
            position: "absolute",
            top: "0.5rem",
            right: "0.5rem",
            display: "flex",
            gap: "0.25rem",
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (typeof onDeleteNote === "function") onDeleteNote(note.id);
            }}
            className="btn-ghost btn-icon"
            style={{ color: "var(--error)", padding: "4px" }}
            title="Delete Note"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={toggleEdit}
            className="btn-ghost btn-icon"
            style={{ padding: "4px" }}
            title="Edit Note"
          >
            <Edit2 size={14} />
          </button>
        </div>
      </div>

      <p
        style={{
          fontSize: "0.9rem",
          opacity: 0.9,
          marginBottom: "0.75rem",
          overflow: "hidden",
          display: "-webkit-box",
          AppkitBoxOrient: "vertical",
          WebkitLineClamp: 4,
        }}
      >
        {note.content}
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          fontSize: "0.8rem",
          opacity: 0.7,
        }}
      >
        {note.tags?.map((t) => (
          <span
            key={t}
            className="note-tag"
            style={{
              background: "var(--bg-surface-3)",
              padding: "2px 6px",
              borderRadius: "4px",
            }}
          >
            #{t}
          </span>
        ))}
        {linkedCount > 0 && (
          <span style={{ color: "var(--primary-color)", fontWeight: "bold" }}>
            🔗 {linkedCount}
          </span>
        )}
      </div>
    </div>
  );
};

export default NoteCard;
