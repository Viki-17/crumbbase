import React, { useState } from "react";
import api from "../api";
import { Trash2, Pencil, Check, X, Link } from "lucide-react";

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
        style={{ cursor: "default", border: "1px solid var(--primary)" }}
      >
        <input
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          placeholder="Title"
          style={{ width: "100%", marginBottom: "0.6rem", fontWeight: "600" }}
        />
        <textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          placeholder="Content"
          rows={5}
          style={{ width: "100%", marginBottom: "0.6rem", resize: "vertical" }}
        />
        <input
          value={editedTags}
          onChange={(e) => setEditedTags(e.target.value)}
          placeholder="Tags (comma separated)"
          style={{ width: "100%", marginBottom: "0.75rem" }}
        />
        <div
          style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}
        >
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary"
            style={{ fontSize: "var(--font-size-xs)", padding: "4px 10px" }}
          >
            <Check size={12} /> {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handleCancel}
            className="btn-ghost"
            style={{ fontSize: "var(--font-size-xs)", padding: "4px 10px" }}
          >
            <X size={12} /> Cancel
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
          ? "1px solid var(--primary)"
          : "1px solid var(--border-color)",
        background: isSelected ? "var(--primary-light)" : "var(--bg-surface-1)",
        transition: "var(--transition-fast)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "0.4rem",
        }}
      >
        <h4
          style={{
            margin: 0,
            color: "var(--text-primary)",
            paddingRight: "50px",
            fontSize: "var(--font-size-sm)",
            fontWeight: "500",
          }}
        >
          {note.title}
        </h4>

        <div
          style={{
            position: "absolute",
            top: "0.6rem",
            right: "0.6rem",
            display: "flex",
            gap: "2px",
            opacity: 0.4,
          }}
          className="note-card-actions"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (typeof onDeleteNote === "function") onDeleteNote(note.id);
            }}
            className="btn-ghost btn-icon"
            style={{ color: "var(--error)", padding: "3px", width: "24px", height: "24px", minHeight: "24px" }}
            title="Delete Note"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={toggleEdit}
            className="btn-ghost btn-icon"
            style={{ padding: "3px", width: "24px", height: "24px", minHeight: "24px" }}
            title="Edit Note"
          >
            <Pencil size={12} />
          </button>
        </div>
      </div>

      <p
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--text-secondary)",
          marginBottom: "0.6rem",
          overflow: "hidden",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 3,
          lineHeight: "1.5",
        }}
      >
        {note.content}
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          alignItems: "center",
        }}
      >
        {note.tags?.map((t) => (
          <span
            key={t}
            className="note-tag"
            style={{
              background: "var(--bg-surface-2)",
              padding: "1px 6px",
              borderRadius: "var(--border-radius-pill)",
              fontSize: "0.65rem",
              color: "var(--text-tertiary)",
            }}
          >
            #{t}
          </span>
        ))}
        {linkedCount > 0 && (
          <span style={{
            color: "var(--primary)",
            fontWeight: "500",
            fontSize: "0.65rem",
            display: "flex",
            alignItems: "center",
            gap: "2px",
          }}>
            <Link size={10} /> {linkedCount}
          </span>
        )}
      </div>
    </div>
  );
};

// Show actions on hover
const style = document.createElement('style');
style.textContent = `.note-card:hover .note-card-actions { opacity: 1 !important; }`;
document.head.appendChild(style);

export default NoteCard;
