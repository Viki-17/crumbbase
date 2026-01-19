const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

// Services
const storage = require("./services/storage");
const {
  extractTextFromPDF,
  splitIntoChapters,
} = require("./services/pdf-processor");
const aiService = require("./services/ai-service");
const ttsService = require("./services/tts-service");
const embeddingService = require("./services/embeddings");
const vectorStore = require("./services/vector-store");
const rabbitmq = require("./services/rabbitmq");
const worker = require("./worker"); // Import worker to run in same process for simplicity

const app = express();
const PORT = process.env.PORT || 3001;
const API_BASE = "/api"; // Centralized API Base

app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// SSE Streaming Helper
const clients = {};
function broadcast(bookId, data) {
  if (clients[bookId]) {
    clients[bookId].forEach((client) => {
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    });
  }
}

// RabbitMQ Event Listener for SSE
rabbitmq.consumeEvents((event) => {
  const { bookId, type, ...payload } = event;
  if (bookId) {
    broadcast(bookId, { type, ...payload });
  }
});

// Start Worker (In same process for now as per "simple setup", but can be separate)
worker.startWorker().catch(console.error);

// --- API Router Setup ---
const router = express.Router();

// List Books
router.get("/books", async (req, res) => {
  try {
    const allBooks = await storage.getAllBooks();

    // For each book, compute effective status based on chapter completion
    const booksWithEffectiveStatus = await Promise.all(
      allBooks.map(async (b) => {
        let effectiveStatus = b.status;

        // If book has chapters, check if all are actually done
        if (b.chapters && b.chapters.length > 0) {
          const chapters = await Promise.all(
            b.chapters.map((chapId) => storage.getChapter(chapId))
          );

          const allChaptersDone = chapters.every((chap) => {
            if (!chap) return false;
            const overviewDone =
              chap.overviewStatus === "completed" ||
              chap.overviewStatus === "skipped";
            const analysisDone =
              chap.analysisStatus === "completed" ||
              chap.analysisStatus === "skipped";
            const notesDone =
              chap.notesStatus === "completed" ||
              chap.notesStatus === "skipped";
            return overviewDone && analysisDone && notesDone;
          });

          if (allChaptersDone) {
            effectiveStatus = "done";
          }
        }

        return {
          id: b.id,
          title: b.title,
          status: effectiveStatus,
          chunkCount: b.chapters ? b.chapters.length : 0,
        };
      })
    );

    res.json(booksWithEffectiveStatus);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Book Details (Full view with structured data)
router.get("/books/:id", async (req, res) => {
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

router.get("/notes", async (req, res) => {
  try {
    const notes = await storage.getAllNotes();
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Note
router.patch("/notes/:id", async (req, res) => {
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
router.delete("/notes/:id", async (req, res) => {
  try {
    await storage.deleteNote(req.params.id);
    res.json({ message: "Note deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Book
router.delete("/books/:id", async (req, res) => {
  try {
    await storage.deleteBook(req.params.id);
    res.json({ message: "Book deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global Book Regeneration
router.post("/books/:id/regenerate", async (req, res) => {
  try {
    const bookId = req.params.id;
    const book = await storage.getBook(bookId);
    if (!book) return res.status(404).json({ error: "Book not found" });

    // Reset all chapters and clear data
    for (const chapId of book.chapters || []) {
      const chapter = await storage.getChapter(chapId);
      if (!chapter) continue;

      // Clear existing notes for this chapter
      await storage.deleteNotesByChapter(bookId, chapId);

      // Clear existing summary
      if (chapter.summaryId) {
        await storage.deleteChapterSummary(chapter.summaryId);
      }

      // Reset chapter statuses
      await storage.updateChapter(chapId, {
        summaryId: null,
        overviewStatus: "pending",
        analysisStatus: "pending",
        notesStatus: "pending",
        status: "pending",
      });

      // Publish job
      await rabbitmq.publishJob({
        type: "overview",
        bookId,
        chapterId: chapId,
        stage: "overview",
      });
    }

    // Delete existing book analysis
    await storage.deleteAnalysis(bookId);

    // Update book status
    await storage.saveBook({ ...book, status: "processing" });

    res.json({ message: "Book regeneration started" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Book Analysis Regeneration
router.post("/books/:id/regenerate-analysis", async (req, res) => {
  try {
    const bookId = req.params.id;
    const book = await storage.getBook(bookId);
    if (!book) return res.status(404).json({ error: "Book not found" });

    // Delete existing analysis
    await storage.deleteAnalysis(bookId);

    // Publish book analysis job with force flag
    await rabbitmq.publishJob({
      type: "book_analysis",
      bookId,
      payload: { force: true },
    });

    res.json({ message: "Analysis regeneration started" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pick File
router.get("/system/pick-file", (req, res) => {
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
router.get("/books/:id/events", (req, res) => {
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

router.post("/chapters/:id/skip/:stage", async (req, res) => {
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

router.post("/chapters/:id/overview", async (req, res) => {
  try {
    const chapterId = req.params.id;
    const chapter = await storage.getChapter(chapterId);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    // Publish Job instead of direct call
    await rabbitmq.publishJob({
      type: "overview",
      bookId: chapter.bookId,
      chapterId,
      stage: "overview",
    });

    // Optimistic UI update
    await updateChapterStageStatus(chapterId, "overview", "processing");
    res.json({ message: "Overview generation started" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/chapters/:id/analysis", async (req, res) => {
  try {
    const chapterId = req.params.id;
    const chapter = await storage.getChapter(chapterId);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    // Publish Job
    await rabbitmq.publishJob({
      type: "analysis",
      bookId: chapter.bookId,
      chapterId,
      stage: "analysis",
    });

    await updateChapterStageStatus(chapterId, "analysis", "processing");
    res.json({ message: "Analysis generation started" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/chapters/:id/notes", async (req, res) => {
  try {
    const chapterId = req.params.id;
    const chapter = await storage.getChapter(chapterId);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    // Publish Job
    await rabbitmq.publishJob({
      type: "notes",
      bookId: chapter.bookId,
      chapterId,
      stage: "notes",
    });

    await updateChapterStageStatus(chapterId, "notes", "processing");
    res.json({ message: "Notes generation started" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/chapters/:id/audio", async (req, res) => {
  try {
    const chapter = await storage.getChapter(req.params.id);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    // Use overview for TTS
    const summary = await storage.getChapterSummary(chapter.summaryId);
    if (!summary || !summary.overview) {
      return res
        .status(400)
        .json({ error: "Chapter overview not available yet" });
    }

    const audioPath = await ttsService.generateAudio(summary.overview);
    ttsService.streamAudio(audioPath, res);
  } catch (err) {
    console.error("TTS Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Graph API Endpoints ---

router.get("/graph", async (req, res) => {
  try {
    const graph = await storage.getGraph();
    res.json(graph);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/links/explain", async (req, res) => {
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

router.post("/links", async (req, res) => {
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
router.get("/notes/:id/links", async (req, res) => {
  try {
    const links = await storage.getNoteLinks(req.params.id);
    res.json(links);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Link Suggestions Endpoint
router.post("/notes/:id/suggest-links", async (req, res) => {
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
router.post("/folders/generate", async (req, res) => {
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

router.get("/folders", async (req, res) => {
  try {
    const folders = await storage.getFolders();
    res.json({ folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const multer = require("multer");
const upload = multer({ dest: "uploads/" });

// Process Book (The Core Pipeline)
router.post("/books", upload.single("file"), async (req, res) => {
  try {
    const bookId = uuidv4();
    let absolutePath = "";
    let isTranscript = false;

    // 1. Handle PDF Upload
    if (req.file) {
      if (req.file.mimetype !== "application/pdf") {
        // Cleanup if not PDF (though multer validation could be better)
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Only PDFs are allowed" });
      }
      absolutePath = path.resolve(req.file.path);
    }
    // 2. Handle Transcript
    else if (req.body.transcript) {
      isTranscript = true;
    } else {
      return res.status(400).json({ error: "No file or transcript provided" });
    }

    console.log(`Processing Book: ${bookId}`);

    // Parse bookType from request (default to 'nonfiction' for backward compat)
    const bookType = req.body.bookType === "fiction" ? "fiction" : "nonfiction";

    const book = {
      id: bookId,
      type: "book",
      title: req.file ? req.file.originalname : "Transcript Upload",
      path: isTranscript ? "TRANSCRIPT" : absolutePath, // path is less relevant for transcript
      bookType: bookType, // 'fiction' or 'nonfiction'
      createdAt: new Date().toISOString(),
      status: "processing",
      chapters: [],
    };
    await storage.saveBook(book);

    res.json({ id: bookId, message: "Processing started" });

    // Trigger Pipeline
    if (isTranscript) {
      // Transcript Flow
      const textChunks = splitIntoChapters(req.body.transcript);
      await processBookWithChunks(bookId, textChunks); // Logic re-used using RabbitMQ inside
    } else {
      // PDF Flow - Extract text first (synchronous for now, or could be a job too)
      // For simplicity, extract here then push chunks
      const text = await extractTextFromPDF(absolutePath);
      const textChunks = splitIntoChapters(text);
      await processBookWithChunks(bookId, textChunks);

      // Cleanup: Delete the uploaded PDF after successful processing
      try {
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
          console.log(`[Server] Deleted uploaded PDF: ${absolutePath}`);
        }
      } catch (cleanupErr) {
        console.error(
          `[Server] Failed to delete uploaded PDF: ${cleanupErr.message}`
        );
      }
    }
  } catch (err) {
    console.error(err);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path); // Cleanup on error
    }
    res.status(500).json({ error: err.message });
  }
});

// Manual Resume/Retry Endpoint
router.post("/chapters/:id/retry", async (req, res) => {
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

// MOUNT ROUTER
app.use(API_BASE, router);

// --- Logic Implementation: RabbitMQ Orchestration ---

async function processBookWithChunks(bookId, textChunks) {
  try {
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

    // Publish Initial Jobs (Overview) for all chapters
    for (const chapId of chapterIds) {
      await rabbitmq.publishJob({
        type: "overview",
        bookId,
        chapterId: chapId,
        stage: "overview",
      });
    }

    console.log(`Pipeline started for book: ${bookId}`);
  } catch (err) {
    console.error(`Pipeline setup failed for ${bookId}`, err);
    let book = await storage.getBook(bookId);
    if (book) {
      book.status = "error";
      await storage.saveBook(book);
    }
  }
}

async function runTranscriptPipeline(bookId, text) {
  try {
    broadcast(bookId, { type: "status", message: "Processing transcript..." });
    const textChunks = splitIntoChapters(text);
    await processBookWithChunks(bookId, textChunks);
  } catch (err) {
    console.error(`Transcript Pipeline failed for ${bookId}`, err);
    // Error handling duplicated? processBookWithChunks handles its own errors mostly, but if split fails or something before...
    const book = await storage.getBook(bookId);
    if (book) {
      book.status = "error";
      await storage.saveBook(book);
      broadcast(bookId, { type: "error", message: err.message });
    }
  }
}

async function runFullPipeline(bookId, filePath, shouldDelete = false) {
  try {
    broadcast(bookId, { type: "status", message: "Extracting text..." });

    const pdfText = await extractTextFromPDF(filePath);

    // Cleanup File if needed
    if (shouldDelete) {
      try {
        fs.unlinkSync(filePath);
        console.log(`Deleted temp file: ${filePath}`);
      } catch (e) {
        console.error("Failed to delete temp file", e);
      }
    }

    const textChunks = splitIntoChapters(pdfText);
    await processBookWithChunks(bookId, textChunks);
  } catch (err) {
    console.error(`Pipeline failed for ${bookId}`, err);
    // Try cleanup even on error
    if (shouldDelete && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const book = await storage.getBook(bookId);
    if (book) {
      book.status = "error";
      await storage.saveBook(book);
      broadcast(bookId, { type: "error", message: err.message });
    }
  }
}

async function runChapterPipeline(bookId, chapterId) {
  // Basic Retry Logic: Check status and publish next job
  const chapter = await storage.getChapter(chapterId);
  if (!chapter) return;

  // Simple heuristic: Try to find first pending/failed step
  if (
    chapter.overviewStatus !== "completed" &&
    chapter.overviewStatus !== "skipped"
  ) {
    await rabbitmq.publishJob({
      type: "overview",
      bookId,
      chapterId,
      stage: "overview",
    });
  } else if (
    chapter.analysisStatus !== "completed" &&
    chapter.analysisStatus !== "skipped"
  ) {
    await rabbitmq.publishJob({
      type: "analysis",
      bookId,
      chapterId,
      stage: "analysis",
    });
  } else if (
    chapter.notesStatus !== "completed" &&
    chapter.notesStatus !== "skipped"
  ) {
    await rabbitmq.publishJob({
      type: "notes",
      bookId,
      chapterId,
      stage: "notes",
    });
  }
}

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
