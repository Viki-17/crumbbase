require("dotenv").config();
const mongoose = require("mongoose");
const { Book, Chapter, Summary, Note, Analysis, Graph } = require("../models");

// --- MongoDB Connection ---
let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    isConnected = true;
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    throw err;
  }
}

// Ensure connection on first call
const ensureConnected = async () => {
  if (!isConnected) await connectDB();
};

// --- Book Operations ---
const saveBook = async (book) => {
  await ensureConnected();
  await Book.findOneAndUpdate({ id: book.id }, book, {
    upsert: true,
    new: true,
  });
};

const getBook = async (id) => {
  await ensureConnected();
  const doc = await Book.findOne({ id }).lean();
  return doc || null;
};

const getAllBooks = async () => {
  await ensureConnected();
  return await Book.find().lean();
};

const deleteBook = async (id) => {
  await ensureConnected();
  console.log(`[Storage] Deleting Book: ${id} and all related data...`);

  // 1. Find Chapters
  const chapters = await Chapter.find({ bookId: id }).lean();
  const chapterIds = chapters.map((c) => c.id);

  // 2. Delete Notes & Graph Nodes for each Chapter
  for (const chapId of chapterIds) {
    await deleteNotesByChapter(id, chapId);
    // Delete Summary
    const chap = await Chapter.findOne({ id: chapId });
    if (chap && chap.summaryId) {
      await Summary.deleteOne({ id: chap.summaryId });
    }
  }

  // 3. Delete Chapters
  await Chapter.deleteMany({ bookId: id });

  // 4. Delete Analysis
  await Analysis.deleteOne({ bookId: id });

  // 5. Delete Book
  await Book.deleteOne({ id });
  console.log(`[Storage] Book ${id} deleted.`);
};

// --- Chapter Operations ---
const saveChapter = async (chapter) => {
  await ensureConnected();
  await Chapter.findOneAndUpdate({ id: chapter.id }, chapter, {
    upsert: true,
    new: true,
  });
};

const getChapter = async (id) => {
  await ensureConnected();
  const doc = await Chapter.findOne({ id }).lean();
  return doc || null;
};

const updateChapter = async (id, updateData) => {
  await ensureConnected();
  const updatedChapter = await Chapter.findOneAndUpdate({ id }, updateData, {
    new: true,
  }).lean();
  return updatedChapter;
};

// --- Summary Operations ---
const saveChapterSummary = async (summary) => {
  await ensureConnected();
  await Summary.findOneAndUpdate({ id: summary.id }, summary, {
    upsert: true,
    new: true,
  });
};

const getChapterSummary = async (id) => {
  await ensureConnected();
  const doc = await Summary.findOne({ id }).lean();
  return doc || null;
};

// --- Note Operations ---
const saveNote = async (note) => {
  await ensureConnected();
  await Note.findOneAndUpdate({ id: note.id }, note, {
    upsert: true,
    new: true,
  });
  // Also sync to graph
  await addNodeToGraph(note);
};

const getNote = async (id) => {
  await ensureConnected();
  const doc = await Note.findOne({ id }).lean();
  return doc || null;
};

const updateNote = async (id, updateData) => {
  await ensureConnected();
  const updatedNote = await Note.findOneAndUpdate({ id }, updateData, {
    new: true,
  }).lean();
  if (updatedNote) {
    // Also update in graph
    const graph = await getGraph();
    if (graph.nodes[id]) {
      graph.nodes[id] = {
        ...graph.nodes[id],
        title: updatedNote.title,
        tags: updatedNote.tags || [],
      };
      await saveGraph(graph);
    }
  }
  return updatedNote;
};

const getAllNotes = async () => {
  await ensureConnected();
  return await Note.find().lean();
};

const deleteNote = async (id) => {
  await ensureConnected();
  await Note.deleteOne({ id });
  await removeNodeFromGraph(id);
};

const deleteNotesByChapter = async (bookId, chapterId) => {
  await ensureConnected();
  // Find all notes for this chapter
  const notes = await Note.find({
    "source.bookId": bookId,
    "source.chapterId": chapterId,
  }).lean();

  const noteIds = notes.map((n) => n.id);

  // Delete from DB
  await Note.deleteMany({ id: { $in: noteIds } });

  // Clean up Graph
  const graph = await getGraph();
  noteIds.forEach((id) => {
    delete graph.nodes[id];
  });
  graph.edges = graph.edges.filter(
    (e) => !noteIds.includes(e.from) && !noteIds.includes(e.to)
  );
  await saveGraph(graph);
};

// --- Analysis Operations ---
const saveAnalysis = async (analysis) => {
  await ensureConnected();
  await Analysis.findOneAndUpdate({ bookId: analysis.bookId }, analysis, {
    upsert: true,
    new: true,
  });
};

const getAnalysis = async (bookId) => {
  await ensureConnected();
  const doc = await Analysis.findOne({ bookId }).lean();
  return doc || null;
};

const deleteAnalysis = async (bookId) => {
  await ensureConnected();
  await Analysis.deleteOne({ bookId });
};

const deleteChapterSummary = async (id) => {
  await ensureConnected();
  if (id) {
    await Summary.deleteOne({ id });
  }
};

// --- Graph Operations ---
const getGraph = async () => {
  await ensureConnected();
  let graph = await Graph.findOne().lean();
  if (!graph) {
    graph = { nodes: {}, edges: [] };
    await Graph.create(graph);
  }
  // Convert Map to plain object if needed
  if (graph.nodes instanceof Map) {
    graph.nodes = Object.fromEntries(graph.nodes);
  }
  return graph;
};

const saveGraph = async (graph) => {
  await ensureConnected();
  await Graph.findOneAndUpdate({}, graph, { upsert: true, new: true });
};

const addNodeToGraph = async (note) => {
  const graph = await getGraph();
  graph.nodes[note.id] = {
    id: note.id,
    type: note.type || "atomic_note",
    title: note.title,
    tags: note.tags || [],
    createdAt: note.createdAt,
  };
  await saveGraph(graph);
};

const removeNodeFromGraph = async (noteId) => {
  const graph = await getGraph();
  delete graph.nodes[noteId];
  graph.edges = graph.edges.filter((e) => e.from !== noteId && e.to !== noteId);
  await saveGraph(graph);
};

const addEdge = async (edge) => {
  const graph = await getGraph();
  const exists = graph.edges.some(
    (e) =>
      (e.from === edge.from && e.to === edge.to) ||
      (e.from === edge.to &&
        e.to === edge.from &&
        edge.direction === "bidirectional")
  );
  if (!exists) {
    graph.edges.push(edge);
    await saveGraph(graph);
  }
  return edge;
};

const removeEdge = async (fromId, toId) => {
  const graph = await getGraph();
  graph.edges = graph.edges.filter(
    (e) =>
      !(
        (e.from === fromId && e.to === toId) ||
        (e.from === toId && e.to === fromId)
      )
  );
  await saveGraph(graph);
};

const getEdgesForNote = async (noteId) => {
  const graph = await getGraph();
  return graph.edges.filter((e) => e.from === noteId || e.to === noteId);
};

const getNoteLinks = async (noteId) => {
  const graph = await getGraph();
  const outgoing = graph.edges
    .filter((e) => e.from === noteId)
    .map((e) => ({
      to: e.to,
      reason: e.reason,
      createdBy: e.createdBy,
      confidence: e.confidence,
    }));

  const backlinks = graph.edges
    .filter((e) => e.to === noteId)
    .map((e) => ({
      from: e.from,
      reason: e.reason,
      createdBy: e.createdBy,
      confidence: e.confidence,
    }));

  return { outgoingLinks: outgoing, backlinks: backlinks };
};

// --- Folder Operations (Metadata) ---
const getFolders = async () => {
  await ensureConnected();
  const doc = await Folder.findOne({ id: "folder-metadata" }).lean();
  return doc ? doc.folders : [];
};

const saveFolders = async (folders) => {
  await ensureConnected();
  await Folder.findOneAndUpdate(
    { id: "folder-metadata" },
    { folders, updatedAt: new Date() },
    { upsert: true }
  );
};

// --- Export ---
module.exports = {
  connectDB,
  // Books
  saveBook,
  getBook,
  getAllBooks,
  deleteBook,
  // Chapters
  // Chapters
  saveChapter,
  getChapter,
  updateChapter,
  // Summaries
  saveChapterSummary,
  getChapterSummary,
  // Notes
  saveNote,
  getNote,
  updateNote,
  getAllNotes,
  deleteNote,
  deleteNotesByChapter,
  // Analysis
  saveAnalysis,
  getAnalysis,
  deleteAnalysis,
  deleteChapterSummary,
  // Graph
  getGraph,
  saveGraph,
  addNodeToGraph,
  removeNodeFromGraph,
  addEdge,
  removeEdge,
  getEdgesForNote,
  getNoteLinks,
  getFolders,
  saveFolders,
};
