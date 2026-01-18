const mongoose = require("mongoose");

// --- Book Schema ---
const bookSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: { type: String, default: "book" },
  title: String,
  path: String,
  createdAt: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ["processing", "done", "error"],
    default: "processing",
  },
  chapters: [String], // Array of chapter IDs
});

// --- Chapter Schema ---
const chapterSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: { type: String, default: "chapter" },
  bookId: String,
  chapterIndex: Number,
  title: String,
  rawText: String,
  summaryId: String,
  // V7: Robust Pipeline Fields
  status: {
    type: String,
    enum: [
      "pending",
      "extraction",
      "summarization",
      "atomic_notes",
      "embeddings",
      "linking",
      "completed",
      "failed",
    ],
    default: "pending",
  },
  // Granular Stage Statuses
  overviewStatus: {
    type: String,
    enum: ["pending", "processing", "completed", "skipped", "failed"],
    default: "pending",
  },
  analysisStatus: {
    type: String,
    enum: ["pending", "processing", "completed", "skipped", "failed"],
    default: "pending",
  },
  notesStatus: {
    type: String,
    enum: ["pending", "processing", "completed", "skipped", "failed"],
    default: "pending",
  },
  lastStep: { type: String, default: null },
  retryCount: { type: Number, default: 0 },
  error: { type: String, default: null },
  updatedAt: { type: Date, default: Date.now },
});

// --- Summary Schema ---
const summarySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: { type: String, default: "chapter_summary" },
  chapterId: String,
  overview: String,
  mainIdea: String,
  keyConcepts: [String],
  examples: [String],
  mentalModels: [String],
  lifeLessons: [String],
  createdAt: { type: Date, default: Date.now },
});

// --- Note Schema ---
const noteSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: { type: String, default: "atomic_note" },
  title: String,
  content: String,
  tags: [String],
  source: {
    bookId: String,
    chapterId: String,
  },
  links: [String],
  suggestedLinks: [
    {
      toId: String,
      reason: String,
      confidence: Number,
    },
  ],
  embedding: [Number],
  createdAt: { type: Date, default: Date.now },
});

// --- Analysis Schema ---
const analysisSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: { type: String, default: "book_summary" },
  bookId: { type: String, unique: true },
  coreThemes: [String],
  keyTakeaways: [String],
  mentalModels: [String],
  practicalApplications: [String],
  createdAt: { type: Date, default: Date.now },
});

// --- Graph Schema (Singleton) ---
const graphSchema = new mongoose.Schema({
  nodes: { type: Map, of: Object, default: {} },
  edges: { type: [Object], default: [] },
});

// --- Folder Schema (Metadata) ---
const folderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // e.g., "folder-metadata"
  type: { type: String, default: "folder_structure" },
  folders: [
    {
      name: String,
      noteIds: [String],
    },
  ],
  updatedAt: { type: Date, default: Date.now },
});

// Models
const Book = mongoose.model("Book", bookSchema);
const Chapter = mongoose.model("Chapter", chapterSchema);
const Summary = mongoose.model("Summary", summarySchema);
const Note = mongoose.model("Note", noteSchema);
const Analysis = mongoose.model("Analysis", analysisSchema);
const Graph = mongoose.model("Graph", graphSchema);

module.exports = {
  Book,
  Chapter,
  Summary,
  Note,
  Analysis,
  Graph,
  Folder: mongoose.model("Folder", folderSchema),
};
