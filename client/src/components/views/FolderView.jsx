import React, { useState, useEffect } from "react";
import api from "../../api";
import { Folder, Sparkles, FileText, ArrowLeft } from "lucide-react";
import Loading from "./../layout/Loading";
import "./../../styles/folder-view.css";

/**
 * FolderView - AI-organized folder display  *
 * Features:
 * - Display AI-generated folder structure
 * - "Auto-Organize" button to trigger AI grouping
 * - Click note to view
 */
const FolderView = ({ onSelectNote, onBack }) => {
  const [folders, setFolders] = useState([]);
  const [allNotes, setAllNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState({});

  useEffect(() => {
    fetchFoldersAndNotes();
  }, []);

  const fetchFoldersAndNotes = async () => {
    try {
      setLoading(true);
      const [foldersRes, notesRes] = await Promise.all([
        api.get("/folders"),
        api.get("/notes?all=true"), // Get all notes, not paginated
      ]);

      setFolders(foldersRes.data.folders || []);
      // Handle paginated response - extract notes array
      setAllNotes(notesRes.data.notes || notesRes.data || []);
    } catch (err) {
      console.error("Failed to fetch folders:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateFolders = async () => {
    try {
      setGenerating(true);
      const res = await api.post("/folders/generate");
      setFolders(res.data.folders || []);
      setExpandedFolders({}); // Reset expansion state on regeneration
    } catch (err) {
      console.error("Failed to generate folders:", err);
      alert("Failed to generate folders: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const toggleFolder = (folderName) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderName]: !prev[folderName],
    }));
  };

  const getNoteById = (noteId) => {
    return allNotes.find((n) => n.id === noteId);
  };

  if (loading) {
    return (
      <div className="folder-view">
        <Loading message="Loading folders..." />
      </div>
    );
  }

  return (
    <div className="folder-view container">
      <div style={{ marginBottom: "1rem" }}>
        <button
          onClick={onBack}
          className="btn-ghost"
          style={{ paddingLeft: 0 }}
        >
          <ArrowLeft size={20} /> Back to Library
        </button>
      </div>
      <div className="folder-view-header">
        <h1 className="folder-view-title">AI-Organized Folders</h1>
        <button
          className="folder-view-action-btn"
          onClick={handleGenerateFolders}
          disabled={generating || allNotes.length === 0}
        >
          <Sparkles size={16} />
          {generating ? "Organizing..." : "Auto-Organize Notes"}
        </button>
      </div>

      {folders.length === 0 ? (
        <div className="folder-view-empty">
          <div className="folder-view-empty-icon">
            <Folder size={64} />
          </div>
          <div className="folder-view-empty-text">
            No folders yet.
            <br />
            Click "Auto-Organize Notes" to let AI group your notes by theme.
          </div>
        </div>
      ) : (
        <div className="folder-list">
          {folders.map((folder, idx) => {
            const isExpanded = !!expandedFolders[folder.name];
            return (
              <div key={idx} className="folder-card">
                <div
                  className="folder-card-header"
                  onClick={() => toggleFolder(folder.name)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="folder-card-title">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        transition: "transform 0.2s ease",
                        transform: isExpanded
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                        marginRight: "0.5rem",
                      }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </div>
                    <Folder size={20} />
                    {folder.name}
                  </div>
                  <span className="folder-card-count">
                    {folder.noteIds?.length || 0} notes
                  </span>
                </div>

                {isExpanded && (
                  <div className="folder-card-notes">
                    {folder.noteIds?.map((noteId) => {
                      const note = getNoteById(noteId);
                      if (!note) return null;

                      return (
                        <div
                          key={noteId}
                          className="folder-note-item"
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent toggling folder when clicking note
                            onSelectNote && onSelectNote(noteId);
                          }}
                        >
                          <FileText className="folder-note-icon" size={16} />
                          <span className="folder-note-title">
                            {note.title}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FolderView;
