require("dotenv").config();
const {
  connectDB,
  getBook,
  getChapter,
  saveBook,
  saveChapter,
  saveChapterSummary,
  saveNote,
  saveAnalysis,
  updateChapter,
  getChapterSummary,
  deleteNotesByChapter,
  saveGraph,
  getAllNotes,
  saveFolders,
} = require("./services/storage");
const aiService = require("./services/ai-service");
const embeddingService = require("./services/embeddings");
const vectorStore = require("./services/vector-store");
const rabbitmq = require("./services/rabbitmq");
const { v4: uuidv4 } = require("uuid");

// --- Helper: Check for Cancellation ---
// The most robust way to handle "delete while in progress" is to check if the record
// still exists in the DB before starting any expensive operation.
async function isCancelled(bookId, chapterId) {
  if (chapterId) {
    const chapter = await getChapter(chapterId);
    if (!chapter) return true;
  }
  const book = await getBook(bookId);
  if (!book) return true;
  return false;
}

// --- Worker Logic ---

async function processJob(job) {
  const { type, bookId, chapterId, stage, payload } = job;
  console.log(`[Worker] Processing Job: ${type} for ${chapterId || bookId}`);

  // PRE-EXECUTION CHECK - Skip for global jobs like folder_organize
  if (type !== "folder_organize" && (await isCancelled(bookId, chapterId))) {
    console.log(`[Worker] Job Cancelled (Data missing): ${type}`);
    return;
  }

  try {
    switch (type) {
      case "overview":
        await handleOverview(bookId, chapterId);
        break;
      case "analysis":
        await handleAnalysis(bookId, chapterId);
        break;
      case "notes":
        await handleNotes(bookId, chapterId);
        break;
      case "book_analysis":
        await handleBookAnalysis(bookId, payload); // payload might contain chapterIds
        break;
      case "folder_organize":
        await handleFolderOrganize();
        break;
      default:
        console.error(`Unknown job type: ${type}`);
    }
  } catch (err) {
    console.error(`[Worker] Job Failed: ${type}`, err);
    // Update DB status to failed
    if (chapterId) {
      await updateChapter(chapterId, {
        [`${stage}Status`]: "failed",
        error: err.message,
      });
      // Publish stageStatus event so UI updates immediately
      rabbitmq.publishEvent({
        type: "stageStatus",
        bookId,
        chapterId,
        stage,
        status: "failed",
      });
      rabbitmq.publishEvent({
        type: "error",
        bookId,
        chapterId,
        stage,
        message: err.message,
      });
    } else if (bookId) {
      // Book level error
      const book = await getBook(bookId);
      if (book) {
        book.status = "error";
        await saveBook(book);
        rabbitmq.publishEvent({ type: "error", bookId, message: err.message });
      }
    }
    // DO NOT trigger next stage on failure - wait for manual retry
  }
}

async function handleOverview(bookId, chapterId) {
  // 1. Fetch Data
  const chapter = await getChapter(chapterId);
  if (!chapter) return;

  const book = await getBook(bookId);
  const bookType = book?.bookType || "nonfiction"; // Default for backward compat

  console.log(`[Worker] Generating Overview for ${chapterId} (${bookType})`);

  // Update Status
  await updateChapter(chapterId, { overviewStatus: "processing" });
  rabbitmq.publishEvent({
    type: "stageStatus",
    bookId,
    chapterId,
    stage: "overview",
    status: "processing",
  });

  // 2. Generate
  let currentOverview = "";
  // Note: We might want streaming if possible, but for RabbitMQ worker -> API -> SSE,
  // we can publish periodic updates or just wait for completion.
  // For better UX, we can publish chunks?
  // Let's stick to full completion for simplicity first, or chunk publishing if the library supports it easily.
  // ai-service supports onToken.

  await aiService.generateChapterOverview(
    chapter.rawText,
    bookType,
    (token) => {
      currentOverview += token;
      // OPTIONAL: Publish stream event (might be too chatty for RabbitMQ? It's fine for local docker usually)
      // rabbitmq.publishEvent({ type: "overviewStream", bookId, chapterId, token });
    },
  );

  // 3. POST-EXECUTION CHECK
  if (await isCancelled(bookId, chapterId)) return;

  // 4. Save
  // Ensure summary doc
  let summary = await getChapterSummary(chapter.summaryId);
  if (!summary) {
    summary = {
      id: uuidv4(),
      type: "chapter_summary",
      chapterId: chapterId,
      createdAt: new Date().toISOString(),
    };
  }
  summary.overview = currentOverview;
  await saveChapterSummary(summary);

  // 5. Update Status & Notify
  chapter.summaryId = summary.id;
  chapter.overviewStatus = "completed";
  await saveChapter(chapter); // Updating chapter to link summary

  rabbitmq.publishEvent({
    type: "stageStatus",
    bookId,
    chapterId,
    stage: "overview",
    status: "completed",
  });

  // 6. Trigger Next Step (Analysis) - only if current stage succeeded
  rabbitmq.publishJob({
    type: "analysis",
    bookId,
    chapterId,
    stage: "analysis",
  });
}

async function handleAnalysis(bookId, chapterId) {
  if (await isCancelled(bookId, chapterId)) return;

  const chapter = await getChapter(chapterId);
  if (!chapter) return;

  const book = await getBook(bookId);
  const bookType = book?.bookType || "nonfiction";

  console.log(`[Worker] Generating Analysis for ${chapterId} (${bookType})`);
  await updateChapter(chapterId, { analysisStatus: "processing" });
  rabbitmq.publishEvent({
    type: "stageStatus",
    bookId,
    chapterId,
    stage: "analysis",
    status: "processing",
  });

  const summaryJSON = await aiService.generateStructuredSummary(
    chapter.rawText,
    bookType,
  );

  if (await isCancelled(bookId, chapterId)) return;

  let summary = await getChapterSummary(chapter.summaryId);
  // It handles if summary is missing (should verify previous step success?)
  if (!summary) summary = { id: uuidv4(), chapterId, type: "chapter_summary" };

  Object.assign(summary, summaryJSON);
  await saveChapterSummary(summary);

  await updateChapter(chapterId, { analysisStatus: "completed" });
  rabbitmq.publishEvent({
    type: "stageStatus",
    bookId,
    chapterId,
    stage: "analysis",
    status: "completed",
  });
  rabbitmq.publishEvent({ type: "chapterDone", bookId, chapterId, summary }); // Update UI

  // Trigger Next Step (Notes) - only if current stage succeeded
  rabbitmq.publishJob({ type: "notes", bookId, chapterId, stage: "notes" });
}

async function handleNotes(bookId, chapterId) {
  if (await isCancelled(bookId, chapterId)) return;

  const chapter = await getChapter(chapterId);
  if (!chapter) return;

  console.log(`[Worker] Generating Notes for ${chapterId}`);

  // Check if analysis was completed - notes require analysis data
  if (chapter.analysisStatus !== "completed") {
    console.warn(
      `[Worker] Analysis not completed for ${chapterId}, status: ${chapter.analysisStatus}`,
    );
    throw new Error(
      `Cannot generate notes - analysis stage is ${
        chapter.analysisStatus || "pending"
      }. Run analysis first.`,
    );
  }

  await updateChapter(chapterId, { notesStatus: "processing" });
  rabbitmq.publishEvent({
    type: "stageStatus",
    bookId,
    chapterId,
    stage: "notes",
    status: "processing",
  });

  const summary = await getChapterSummary(chapter.summaryId);
  if (!summary)
    throw new Error("Summary document missing for notes generation");

  // Log what we have in the summary
  console.log(`[Worker] Summary for ${chapterId}:`, {
    hasMainIdea: !!summary.mainIdea,
    keyConceptsCount: summary.keyConcepts?.length || 0,
    examplesCount: summary.examples?.length || 0,
  });

  // Validate summary has required fields from analysis stage
  if (
    !summary.mainIdea &&
    (!summary.keyConcepts || summary.keyConcepts.length === 0)
  ) {
    throw new Error(
      "Summary has no usable content for notes generation - analysis may have failed",
    );
  }

  // Clear existing
  await deleteNotesByChapter(bookId, chapterId);

  // Pass complete summary to generate better notes
  const notesData = await aiService.generateAtomicNotes({
    mainIdea: summary.mainIdea || "",
    keyConcepts: summary.keyConcepts || [],
    examples: summary.examples || [],
    mentalModels: summary.mentalModels || [],
    lifeLessons: summary.lifeLessons || [],
  });

  if (await isCancelled(bookId, chapterId)) return;

  // Process Notes
  const notesPromises = notesData.map(async (n) => {
    const noteId = uuidv4();
    const embedding = await embeddingService.generateEmbedding(
      `${n.title}\n${n.content}`,
    );

    // Suggest Links (this could be its own job if too slow)
    // We'll keep it here for now
    const tempNote = {
      id: noteId,
      title: n.title,
      content: n.content,
      embedding,
    };
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
    await saveNote(note);
    vectorStore.addNoteToCache(note);
  });

  await Promise.all(notesPromises);

  if (await isCancelled(bookId, chapterId)) return; // Final check

  await updateChapter(chapterId, {
    notesStatus: "completed",
    status: "completed",
  });
  rabbitmq.publishEvent({
    type: "stageStatus",
    bookId,
    chapterId,
    stage: "notes",
    status: "completed",
  });
  rabbitmq.publishEvent({ type: "chapterFinalized", bookId, chapterId });

  // OPTIONAL: Trigger Book Analysis if all chapters done?
  // Ideally API service manages "Book Completion" check, or we trigger a 'CheckBookCompletion' job?
  // Let's rely on API or a separate job.
  rabbitmq.publishJob({
    type: "book_analysis",
    bookId,
    payload: { checkOnly: true },
  });
}

async function handleBookAnalysis(bookId, payload) {
  if (await isCancelled(bookId)) return;

  const book = await getBook(bookId);
  if (!book) return;

  // If force flag is set, skip the "all done" check and regenerate
  const forceRegenerate = payload?.force === true;

  // Check if all chapters are done
  // We need to fetch all chapters
  let allDone = true;
  const allSummaries = [];

  // This is expensive if we do it every time.
  // Ideally: payload has list of chapters, or we assume logic.
  // Let's iterate book.chapters
  for (const chapId of book.chapters) {
    const chap = await getChapter(chapId);
    if (!chap) continue;

    // Check granular stage statuses instead of just chapter status
    const overviewDone =
      chap.overviewStatus === "completed" || chap.overviewStatus === "skipped";
    const analysisDone =
      chap.analysisStatus === "completed" || chap.analysisStatus === "skipped";
    const notesDone =
      chap.notesStatus === "completed" || chap.notesStatus === "skipped";
    const chapterComplete = overviewDone && analysisDone && notesDone;

    if (!chapterComplete) {
      if (!forceRegenerate) {
        allDone = false;
        break;
      }
    }
    if (chap.summaryId) {
      const sum = await getChapterSummary(chap.summaryId);
      if (sum) allSummaries.push(sum);
    }
  }

  if (!allDone && !forceRegenerate) {
    // nothing to do yet
    return;
  }

  // Need at least some summaries to generate analysis
  if (allSummaries.length === 0) {
    console.log(`[Worker] No summaries available for book analysis: ${bookId}`);
    return;
  }

  // All done? Generate analysis if not exists
  const existingAnalysis =
    await require("./services/storage").getAnalysis(bookId); // Avoiding circular dep issues if any, require inline ok?
  // We imported getAnalysis at top, let's use it.

  console.log(
    `[Worker] generating overall book analysis for ${bookId} (${
      book.bookType || "nonfiction"
    })`,
  );

  rabbitmq.publishEvent({
    type: "status",
    bookId,
    message: "Synthesizing Book Analysis...",
  });

  try {
    const analysisJSON = await aiService.generateOverallAnalysis(
      allSummaries,
      book.bookType || "nonfiction",
    );

    if (await isCancelled(bookId)) return;

    const analysis = {
      id: uuidv4(),
      type: "book_summary",
      bookId,
      ...analysisJSON,
      createdAt: new Date().toISOString(),
    };
    await saveAnalysis(analysis);

    book.status = "done";
    await saveBook(book);

    rabbitmq.publishEvent({ type: "bookDone", bookId, book });
    console.log(`[Worker] Book Analysis Complete: ${bookId}`);
  } catch (err) {
    console.error("Book Analysis Failed", err);
    // Don't fail the whole book?
  }
}

// Global flag to prevent concurrent folder organization
let isFolderOrganizing = false;

async function handleFolderOrganize() {
  console.log("[Worker] Starting folder organization...");

  // Prevent duplicate processing
  if (isFolderOrganizing) {
    console.log(
      "[Worker] Folder organization already in progress, skipping...",
    );
    rabbitmq.publishEvent({
      type: "foldersError",
      error: "Organization already in progress",
    });
    return;
  }

  isFolderOrganizing = true;

  try {
    rabbitmq.publishEvent({
      type: "foldersProcessing",
      message: "AI is organizing your notes into folders...",
    });

    const notes = await getAllNotes();

    if (notes.length === 0) {
      console.log("[Worker] No notes to organize");
      rabbitmq.publishEvent({
        type: "foldersDone",
        folders: [],
        message: "No notes to organize",
      });
      isFolderOrganizing = false;
      return;
    }

    console.log(`[Worker] Organizing ${notes.length} notes into folders...`);

    // Progressive callback - saves and publishes after each batch
    const onProgress = async (progress) => {
      console.log(
        `[Worker] Batch ${progress.batchNumber}/${progress.totalBatches} complete`,
      );

      // Save progressive results to DB
      await saveFolders(progress.folders);

      // Publish progress event to UI
      rabbitmq.publishEvent({
        type: "foldersProgress",
        current: progress.batchNumber,
        total: progress.totalBatches,
        folders: progress.folders,
        message: `Processing batch ${progress.batchNumber} of ${progress.totalBatches}...`,
      });
    };

    const structure = await aiService.generateFolderStructure(
      notes,
      onProgress,
    );
    const folders = structure.folders || [];

    // Final save (redundant but ensures consistency)
    await saveFolders(folders);

    console.log(
      `[Worker] Folder organization complete: ${folders.length} folders created`,
    );

    rabbitmq.publishEvent({
      type: "foldersDone",
      folders,
      message: `Organization complete! Created ${folders.length} folders.`,
    });
  } catch (err) {
    console.error("[Worker] Folder organization failed:", err);
    rabbitmq.publishEvent({
      type: "foldersError",
      error: err.message,
    });
  } finally {
    // Always reset flag
    isFolderOrganizing = false;
  }
}

// --- Bootstrap ---
async function startWorker() {
  await connectDB();
  await rabbitmq.connectRabbitMQ();

  rabbitmq.consumeJobs(processJob);
  console.log("[Worker] Service Started");
}

if (require.main === module) {
  startWorker();
}

module.exports = { startWorker };
