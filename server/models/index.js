const mongoose = require("mongoose");

// --- Book Schema ---
const bookSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: { type: String, default: "book" },
  title: String,
  path: String,
  createdAt: { type: Date, default: Date.now },
  bookType: {
    type: String,
    enum: ["fiction", "nonfiction"], // Note: index.js uses 'nonfiction' not 'non-fiction'
    default: "nonfiction",
  },
  sourceType: {
    type: String, // 'youtube', 'blog', or null (for regular books)
    default: null,
  },
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

// --- Job Schema (DB-backed queue, ported from learncache's jobs table) ---
// Replaces RabbitMQ ai.jobs.v2: status + attempts + nextRunAt drive a 2s
// poll loop with quadratic backoff (see server/services/jobs.js).
const jobSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: {
    type: String,
    required: true,
    enum: ["overview", "notes", "book_analysis", "folder_organize"],
  },
  bookId: { type: String, default: null },
  chapterId: { type: String, default: null },
  stage: { type: String, default: null },
  payload: { type: Object, default: {} },
  status: {
    type: String,
    enum: ["queued", "running", "complete", "failed"],
    default: "queued",
  },
  attempts: { type: Number, default: 0 },
  nextRunAt: { type: Date, default: Date.now },
  error: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
jobSchema.index({ status: 1, nextRunAt: 1 });

// --- ProcessingLog Schema (per-book/chapter timeline, ported from learncache) ---
const processingLogSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  bookId: { type: String, default: null },
  chapterId: { type: String, default: null },
  level: { type: String, enum: ["info", "warn", "error"], default: "info" },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
processingLogSchema.index({ bookId: 1, createdAt: 1 });
processingLogSchema.index({ chapterId: 1, createdAt: 1 });

// Models
const Book = mongoose.model("Book", bookSchema);
const Chapter = mongoose.model("Chapter", chapterSchema);
const Summary = mongoose.model("Summary", summarySchema);
const Note = mongoose.model("Note", noteSchema);
const Analysis = mongoose.model("Analysis", analysisSchema);
const Graph = mongoose.model("Graph", graphSchema);
const Job = mongoose.model("Job", jobSchema);
const ProcessingLog = mongoose.model("ProcessingLog", processingLogSchema);

module.exports = {
  Book,
  Chapter,
  Summary,
  Note,
  Analysis,
  Graph,
  Job,
  ProcessingLog,
  Folder: mongoose.model("Folder", folderSchema),
};
