const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const { exec } = require("child_process");

// Services
const storage = require("./services/storage");
const {
  extractTextFromPDF,
  splitIntoChapters,
} = require("./services/pdf-processor");
const aiService = require("./services/ai-service");
const embeddingService = require("./services/embeddings");
const vectorStore = require("./services/vector-store");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

// SSE Streaming Helper
const clients = {};
function broadcast(bookId, data) {
  if (clients[bookId]) {
    clients[bookId].forEach((client) => {
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    });
  }
}

// --- API Endpoints ---

// List Books
app.get("/api/books", async (req, res) => {
  try {
    const allBooks = await storage.getAllBooks();
    const books = allBooks.map((b) => ({
      id: b.id,
      title: b.title,
      status: b.status,
      chunkCount: b.chapters ? b.chapters.length : 0,
    }));
    res.json(books);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Book Details (Full view with structured data)
app.get("/api/books/:id", async (req, res) => {
  try {
    const book = await storage.getBook(req.params.id);
    if (!book) return res.status(404).json({ error: "Book not found" });

    // Hydrate chapters with summaries
    const chapters = [];
    for (const chapId of book.chapters || []) {
      const chap = await storage.getChapter(chapId);
      const summary =
        chap && chap.summaryId
          ? await storage.getChapterSummary(chap.summaryId)
          : null;
      chapters.push({ ...chap, summary });
    }

    const analysis = await storage.getAnalysis(book.id);

    res.json({
      ...book,
      chapters,
      overallAnalysis: analysis,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/notes", async (req, res) => {
  try {
    const notes = await storage.getAllNotes();
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Note
app.patch("/api/notes/:id", async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    const updatedNote = await storage.updateNote(req.params.id, {
      title,
      content,
      tags,
    });
    if (!updatedNote) return res.status(404).json({ error: "Note not found" });
    res.json(updatedNote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Note
app.delete("/api/notes/:id", async (req, res) => {
  try {
    await storage.deleteNote(req.params.id);
    res.json({ message: "Note deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Book
app.delete("/api/books/:id", async (req, res) => {
  try {
    await storage.deleteBook(req.params.id);
    res.json({ message: "Book deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pick File
app.get("/api/system/pick-file", (req, res) => {
  const script = `
      set resultParams to ""
      try
        set theFile to choose file with prompt "Select a PDF book" of type {"pdf"}
        set thePath to POSIX path of theFile
        set resultParams to thePath
      on error
        set resultParams to ""
      end try
      return resultParams
    `;
  exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
    if (error) return res.status(500).json({ error: "Failed" });
    res.json({ filePath: stdout.trim() });
  });
});

// SSE
app.get("/api/books/:id/events", (req, res) => {
  const bookId = req.params.id;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  if (!clients[bookId]) clients[bookId] = [];
  clients[bookId].push(res);
  req.on("close", () => {
    clients[bookId] = clients[bookId].filter((c) => c !== res);
  });
});

// --- Granular Generation Endpoints ---

// Helper: Update Stage Status
async function updateChapterStageStatus(chapterId, stage, status) {
  const update = { [`${stage}Status`]: status };
  await storage.updateChapter(chapterId, update);
}

app.post("/api/chapters/:id/skip/:stage", async (req, res) => {
  try {
    const { id, stage } = req.params;
    const chapter = await storage.getChapter(id);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    if (!["overview", "analysis", "notes"].includes(stage)) {
      return res.status(400).json({ error: "Invalid stage" });
    }

    await updateChapterStageStatus(id, stage, "skipped");

    // Trigger pipeline to continue if needed
    // We run the pipeline again, and let it pick up the next available step
    // But we need to respond first
    res.json({ message: `Stage ${stage} skipped` });

    // Continue pipeline async
    runChapterPipeline(chapter.bookId, id);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chapters/:id/overview", async (req, res) => {
  try {
    const chapterId = req.params.id;
    const chapter = await storage.getChapter(chapterId);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    processStep(chapter.bookId, chapterId, "overview");
    res.json({ message: "Overview generation started" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chapters/:id/analysis", async (req, res) => {
  try {
    const chapterId = req.params.id;
    const chapter = await storage.getChapter(chapterId);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    processStep(chapter.bookId, chapterId, "analysis");
    res.json({ message: "Analysis generation started" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chapters/:id/notes", async (req, res) => {
  try {
    const chapterId = req.params.id;
    const chapter = await storage.getChapter(chapterId);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    processStep(chapter.bookId, chapterId, "notes");
    res.json({ message: "Notes generation started" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Graph API Endpoints ---

app.get("/api/graph", async (req, res) => {
  try {
    const graph = await storage.getGraph();
    res.json(graph);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/links/explain", async (req, res) => {
  const { noteIdA, noteIdB } = req.body;
  if (!noteIdA || !noteIdB) {
    return res.status(400).json({ error: "noteIdA and noteIdB required" });
  }

  try {
    const noteA = await storage.getNote(noteIdA);
    const noteB = await storage.getNote(noteIdB);

    if (!noteA || !noteB) {
      return res.status(404).json({ error: "One or both notes not found" });
    }

    const explanation = await aiService.explainLinkRelationship(
      { title: noteA.title, content: noteA.content, tags: noteA.tags },
      { title: noteB.title, content: noteB.content, tags: noteB.tags }
    );
    res.json({ explanation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/links", async (req, res) => {
  const { from, to, reason } = req.body;
  if (!from || !to || !reason) {
    return res.status(400).json({ error: "from, to, and reason required" });
  }

  try {
    const edge = {
      from,
      to,
      type: "conceptual",
      direction: "bidirectional",
      createdBy: "manual",
      confidence: 1.0,
      reason,
      createdAt: new Date().toISOString(),
    };

    await storage.addEdge(edge);
    res.json({ message: "Link created", edge });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Linked View Endpoint
app.get("/api/notes/:id/links", async (req, res) => {
  try {
    const links = await storage.getNoteLinks(req.params.id);
    res.json(links);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Link Suggestions Endpoint
app.post("/api/notes/:id/suggest-links", async (req, res) => {
  try {
    const note = await storage.getNote(req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });

    // We need embedding. If missing, generate it.
    if (!note.embedding || note.embedding.length === 0) {
      note.embedding = await embeddingService.generateEmbedding(
        `${note.title}\n${note.content}`
      );
      await storage.saveNote(note);
    }

    const suggestions = await vectorStore.suggestLinks(note);
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto Grouping (Folders) Endpoint
app.post("/api/folders/generate", async (req, res) => {
  try {
    const notes = await storage.getAllNotes();
    if (notes.length === 0) return res.json({ folders: [] });

    const structure = await aiService.generateFolderStructure(notes);
    await storage.saveFolders(structure.folders || []);
    res.json(structure);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/folders", async (req, res) => {
  try {
    const folders = await storage.getFolders();
    res.json({ folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Process Book (The Core Pipeline)
app.post("/api/books", async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: "Path required" });

  try {
    const absolutePath = path.resolve(filePath);
    console.log(`Processing: ${absolutePath}`);

    const bookId = uuidv4();
    const book = {
      id: bookId,
      type: "book",
      title: path.basename(absolutePath),
      path: absolutePath,
      createdAt: new Date().toISOString(),
      status: "processing",
      chapters: [],
    };
    await storage.saveBook(book);

    res.json({ id: bookId, message: "Processing started" });

    runFullPipeline(bookId, absolutePath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Logic Implementation ---

// --- Logic Implementation: Robust State Machine ---

const STEPS = ["extraction", "summarization", "atomic_notes", "completed"];

async function updateChapterStatus(chapterId, status, error = null) {
  const update = { status, error };
  if (status !== "failed") {
    update.lastStep = status;
    update.error = null; // Clear error on progress
  } else {
    update.$inc = { retryCount: 1 };
  }
  await storage.updateChapter(chapterId, update);
}

// --- Helper: Robust Retry ---
async function withRetry(fn, label = "Operation", maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const delay = Math.pow(2, i) * 1000;
      console.warn(
        `[RETRY] ${label} failed (attempt ${
          i + 1
        }/${maxRetries}). Retrying in ${delay}ms...`,
        err.message
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function checkChapterCompletion(bookId, chapterId) {
  const chapter = await storage.getChapter(chapterId);
  const stages = ["overview", "analysis", "notes"];

  const allDone = stages.every(
    (s) =>
      chapter[`${s}Status`] === "completed" ||
      chapter[`${s}Status`] === "skipped"
  );

  const anyFailed = stages.some((s) => chapter[`${s}Status`] === "failed");

  if (anyFailed) {
    await updateChapterStatus(chapterId, "failed");
    broadcast(bookId, { type: "chapterStatus", chapterId, status: "failed" });
  } else if (allDone) {
    await updateChapterStatus(chapterId, "completed");
    broadcast(bookId, {
      type: "chapterStatus",
      chapterId,
      status: "completed",
    });
    broadcast(bookId, { type: "chapterDone", chapterId });
  }
}

async function generateChapterSummaryLogic(bookId, chapterId) {
  console.log(`[PIPELINE] Starting Summary/Analysis for Chapter: ${chapterId}`);
  let chapter = await storage.getChapter(chapterId);

  // --- OVERVIEW ---
  if (
    chapter.overviewStatus !== "completed" &&
    chapter.overviewStatus !== "skipped"
  ) {
    await updateChapterStageStatus(chapterId, "overview", "processing");
    broadcast(bookId, {
      type: "stageStatus",
      chapterId,
      stage: "overview",
      status: "processing",
    }); // New event type? Or reuse chapterStatus? Let's assume client handles it.
    // Actually, let's just stick to updateChapterStatus for now or add specific broadcast if needed.
    // Ideally we broadcast the full chapter update.

    try {
      // Ensure summary doc exists
      let summary = await storage.getChapterSummary(chapter.summaryId);
      if (!summary) {
        summary = {
          id: uuidv4(),
          type: "chapter_summary",
          chapterId: chapterId,
          createdAt: new Date().toISOString(),
        };
        await storage.saveChapterSummary(summary);
        chapter.summaryId = summary.id;
        await storage.saveChapter(chapter);
      }

      console.log(`[PIPELINE] Generating Overview for Chapter: ${chapterId}`);
      let currentOverview = "";
      await withRetry(
        () =>
          aiService.generateChapterOverview(chapter.rawText, (token) => {
            currentOverview += token;
            broadcast(bookId, {
              type: "overviewStream",
              chapterId,
              token,
              content: currentOverview,
            });
          }),
        "Overview Generation"
      );
      summary.overview = currentOverview;
      await storage.saveChapterSummary(summary);
      await updateChapterStageStatus(chapterId, "overview", "completed");
    } catch (err) {
      console.error("Overview Failed", err);
      await updateChapterStageStatus(chapterId, "overview", "failed");
      throw err; // Re-throw to stop pipeline? Or continue?
      // If one fails, we probably stop this branch.
    }
  }

  // --- ANALYSIS ---
  // Refresh chapter state
  chapter = await storage.getChapter(chapterId);
  if (
    chapter.analysisStatus !== "completed" &&
    chapter.analysisStatus !== "skipped"
  ) {
    await updateChapterStageStatus(chapterId, "analysis", "processing");
    try {
      // Ensure summary doc (might have been created above)
      let summary = await storage.getChapterSummary(chapter.summaryId);

      console.log(
        `[PIPELINE] Generating Structured Analysis for Chapter: ${chapterId}`
      );
      const summaryJSON = await withRetry(
        () => aiService.generateStructuredSummary(chapter.rawText),
        "Structured Summary Generation"
      );

      Object.assign(summary, summaryJSON);
      await storage.saveChapterSummary(summary);

      await updateChapterStageStatus(chapterId, "analysis", "completed");
      broadcast(bookId, { type: "chapterDone", chapterId, summary });
    } catch (err) {
      console.error("Analysis Failed", err);
      await updateChapterStageStatus(chapterId, "analysis", "failed");
      throw err;
    }
  }
}

async function generateChapterNotesLogic(bookId, chapterId) {
  console.log(`[PIPELINE] Starting Atomic Notes for Chapter: ${chapterId}`);
  let chapter = await storage.getChapter(chapterId);

  if (
    chapter.notesStatus === "completed" ||
    chapter.notesStatus === "skipped"
  ) {
    return;
  }

  await updateChapterStageStatus(chapterId, "notes", "processing");

  try {
    const summary = await storage.getChapterSummary(chapter.summaryId);
    if (!summary) {
      throw new Error("Cannot generate notes without chapter summary/analysis");
    }

    // IDEMPOTENCY: Clear existing notes for this chapter before generating new ones
    console.log(
      `[PIPELINE] Clearing existing notes for Chapter: ${chapterId} to prevent duplicates`
    );
    await storage.deleteNotesByChapter(bookId, chapterId);

    const notesData = await withRetry(
      () =>
        aiService.generateAtomicNotes({
          mainIdea: summary.mainIdea || "Generated from raw text",
          keyConcepts: summary.keyConcepts || [],
        }),
      "Atomic Notes Generation"
    );

    console.log(
      `[PIPELINE] Generated ${notesData.length} note suggestions for Chapter: ${chapterId}`
    );

    for (const n of notesData) {
      const noteId = uuidv4();

      // Embedding generation with retry
      const embedding = await withRetry(
        () => embeddingService.generateEmbedding(`${n.title}\n${n.content}`),
        "Embedding Generation"
      );

      // Temp note for vector search
      const tempNote = {
        id: noteId,
        title: n.title,
        content: n.content,
        embedding,
      };

      // Suggesting links (internal cache, lower risk but still)
      const suggestions = await vectorStore.suggestLinks(tempNote);

      const note = {
        id: noteId,
        type: "atomic_note",
        title: n.title,
        content: n.content,
        tags: n.tags || [],
        source: { bookId, chapterId },
        links: [],
        suggestedLinks: suggestions,
        embedding,
        createdAt: new Date().toISOString(),
      };
      await storage.saveNote(note);
      vectorStore.addNoteToCache(note);
    }

    await updateChapterStageStatus(chapterId, "notes", "completed");
    broadcast(bookId, { type: "chapterDone", chapterId }); // Trigger refetch
    console.log(`[PIPELINE] Atomic Notes Completed for Chapter: ${chapterId}`);
  } catch (err) {
    console.error("Notes Failed", err);
    await updateChapterStageStatus(chapterId, "notes", "failed");
    throw err;
  }
}

async function processStep(bookId, chapterId, targetStep) {
  console.log(
    `[API] Manual step triggered: ${targetStep} for chapter ${chapterId}`
  );
  try {
    // Reset status to pending so it runs
    await updateChapterStageStatus(chapterId, targetStep, "pending");

    // Run pipeline logic
    // We basically kick off runChapterPipeline but focus on the target step
    // But since runChapterPipeline is sequential, let's just run the specific logic functions

    if (targetStep === "overview") {
      await generateChapterSummaryLogic(bookId, chapterId); // This runs Overview AND Analysis if needed, but we can rely on checks inside
      // Check if we should continue?
      runChapterPipeline(bookId, chapterId);
    } else if (targetStep === "analysis") {
      // Force allow analysis even if overview is pending? No, let standard logic apply.
      // But user might want to retry just analysis.
      // generateChapterSummaryLogic handles both.
      await generateChapterSummaryLogic(bookId, chapterId);
      runChapterPipeline(bookId, chapterId);
    } else if (targetStep === "notes") {
      await generateChapterNotesLogic(bookId, chapterId);
      checkChapterCompletion(bookId, chapterId);
    }
  } catch (err) {
    console.error(`[API] Manual step ${targetStep} failed:`, err);
    broadcast(bookId, {
      type: "error",
      message: `Step ${targetStep} failed: ${err.message}`,
    });
  }
}

async function runChapterPipeline(bookId, chapterId) {
  try {
    // Update main status to processing if not already
    await updateChapterStatus(chapterId, "summarization"); // keeping generic status for legacy compatibility/badge

    // 1. Overview & Analysis
    await generateChapterSummaryLogic(bookId, chapterId);

    // 2. Atomic Notes (only if 1 didn't fail hard enough to throw)
    await generateChapterNotesLogic(bookId, chapterId);

    // 3. Final Check
    await checkChapterCompletion(bookId, chapterId);
  } catch (err) {
    console.error(`Chapter ${chapterId} Failed in pipeline:`, err);
    // Don't mark whole chapter failed if just one step failed?
    // logic in checkChapterCompletion will handle "failed" status if any sub-status is failed.
    await checkChapterCompletion(bookId, chapterId);

    broadcast(bookId, {
      type: "error",
      message: `Chapter failed: ${err.message}`,
    });
  }
}

async function runFullPipeline(bookId, filePath) {
  try {
    broadcast(bookId, { type: "status", message: "Extracting text..." });

    const pdfText = await extractTextFromPDF(filePath);
    const textChunks = splitIntoChapters(pdfText);

    let book = await storage.getBook(bookId);

    const chapterIds = [];
    for (let i = 0; i < textChunks.length; i++) {
      const chapId = uuidv4();
      const chapter = {
        id: chapId,
        type: "chapter",
        bookId,
        chapterIndex: i + 1,
        title: `Chapter ${i + 1}`,
        rawText: textChunks[i],
        summaryId: null,
        status: "pending",
        lastStep: "extraction",
        // Default granular statuses
        overviewStatus: "pending",
        analysisStatus: "pending",
        notesStatus: "pending",
      };
      await storage.saveChapter(chapter);
      chapterIds.push(chapId);
    }

    book.chapters = chapterIds;
    await storage.saveBook(book);
    broadcast(bookId, { type: "bookUpdate", book });

    // Process Chapters Sequentially
    for (const chapId of chapterIds) {
      await runChapterPipeline(bookId, chapId);
    }

    // Book Summary
    broadcast(bookId, {
      type: "status",
      message: "Synthesizing Book Analysis...",
    });
    const allSummaries = [];
    for (const chapId of chapterIds) {
      const chap = await storage.getChapter(chapId);
      if (chap.status === "completed" && chap.summaryId) {
        const sum = await storage.getChapterSummary(chap.summaryId);
        if (sum) allSummaries.push(sum);
      }
    }

    if (allSummaries.length > 0) {
      const analysisJSON = await aiService.generateOverallAnalysis(
        allSummaries
      );
      const analysis = {
        id: uuidv4(),
        type: "book_summary",
        bookId,
        ...analysisJSON,
        createdAt: new Date().toISOString(),
      };
      await storage.saveAnalysis(analysis);
    }

    book = await storage.getBook(bookId);
    book.status = "done";
    await storage.saveBook(book);

    broadcast(bookId, { type: "bookDone", book });
    console.log(`Pipeline complete for book: ${bookId}`);
  } catch (err) {
    console.error(`Pipeline failed for ${bookId}`, err);
    const book = await storage.getBook(bookId);
    if (book) {
      book.status = "error";
      await storage.saveBook(book);
      broadcast(bookId, { type: "error", message: err.message });
    }
  }
}

// Manual Resume/Retry Endpoint
app.post("/api/chapters/:id/retry", async (req, res) => {
  try {
    const chapterId = req.params.id;
    const chapter = await storage.getChapter(chapterId);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    // Reset to pending or just run pipeline?
    // runChapterPipeline handles 'failed' status by retrying from last valid step logic

    // Respond immediately
    res.json({ message: "Retry started" });

    // Async execution
    runChapterPipeline(chapter.bookId, chapterId);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Server Startup ---
async function startServer() {
  try {
    await storage.connectDB();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
