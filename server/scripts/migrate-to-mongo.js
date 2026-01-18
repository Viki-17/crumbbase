/**
 * Migration Script: JSON Files -> MongoDB
 *
 * Usage: node server/scripts/migrate-to-mongo.js
 *
 * This script reads all existing JSON data from:
 * 1. The multi-file structure in `data/`
 * 2. The legacy single-file `server/db.json`
 * and inserts it into MongoDB collections.
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const mongoose = require("mongoose");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { Book, Chapter, Summary, Note, Analysis, Graph } = require("../models");

const DATA_DIR = path.join(__dirname, "../../data");
const DB_JSON_PATH = path.join(__dirname, "../../server/db.json");

function readFilesFromDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      } catch (e) {
        console.error(`Failed to read ${f}:`, e.message);
        return null;
      }
    })
    .filter(Boolean);
}

async function migrate() {
  console.log("Starting migration to MongoDB...");
  console.log(`Connecting to: ${process.env.MONGODB_URI}`);

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB connected");

    // --- 1. Migrate from data/ (Multi-file structure) ---
    console.log("\n--- Migrating from data/ directory ---");

    const multiBooks = readFilesFromDir(path.join(DATA_DIR, "books"));
    console.log(`Found ${multiBooks.length} books in data/`);
    for (const book of multiBooks) {
      await Book.findOneAndUpdate({ id: book.id }, book, { upsert: true });
    }

    const multiChapters = readFilesFromDir(path.join(DATA_DIR, "chapters"));
    console.log(`Found ${multiChapters.length} chapters in data/`);
    for (const chapter of multiChapters) {
      await Chapter.findOneAndUpdate({ id: chapter.id }, chapter, {
        upsert: true,
      });
    }

    const multiSummaries = readFilesFromDir(path.join(DATA_DIR, "summaries"));
    console.log(`Found ${multiSummaries.length} summaries in data/`);
    for (const summary of multiSummaries) {
      await Summary.findOneAndUpdate({ id: summary.id }, summary, {
        upsert: true,
      });
    }

    const multiNotes = readFilesFromDir(path.join(DATA_DIR, "notes"));
    console.log(`Found ${multiNotes.length} notes in data/`);
    for (const note of multiNotes) {
      await Note.findOneAndUpdate({ id: note.id }, note, { upsert: true });
    }

    const multiAnalyses = readFilesFromDir(path.join(DATA_DIR, "analysis"));
    console.log(`Found ${multiAnalyses.length} analyses in data/`);
    for (const analysis of multiAnalyses) {
      await Analysis.findOneAndUpdate({ bookId: analysis.bookId }, analysis, {
        upsert: true,
      });
    }

    const graphPath = path.join(DATA_DIR, "graph.json");
    if (fs.existsSync(graphPath)) {
      const graphData = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
      await Graph.findOneAndUpdate({}, graphData, { upsert: true });
      console.log("✅ Graph migrated from data/");
    }

    // --- 2. Migrate from server/db.json (Legacy structure) ---
    console.log("\n--- Migrating from server/db.json ---");
    if (fs.existsSync(DB_JSON_PATH)) {
      const dbContent = JSON.parse(fs.readFileSync(DB_JSON_PATH, "utf-8"));

      if (dbContent.books && Array.isArray(dbContent.books)) {
        console.log(`Found ${dbContent.books.length} books in db.json`);
        for (const legacyBook of dbContent.books) {
          // Check if already migrated
          const exists = await Book.findOne({ id: legacyBook.id });
          if (exists) {
            console.log(`Book ${legacyBook.id} already exists, skipping.`);
            continue;
          }

          const chapterIds = [];

          // Map chunks to chapters and summaries
          if (legacyBook.chunks && Array.isArray(legacyBook.chunks)) {
            for (const chunk of legacyBook.chunks) {
              const chapterId = `chap-${legacyBook.id}-${chunk.id}`;
              const summaryId = `sum-${legacyBook.id}-${chunk.id}`;

              // Create Summary
              if (chunk.summary) {
                await Summary.findOneAndUpdate(
                  { id: summaryId },
                  {
                    id: summaryId,
                    type: "chapter_summary",
                    chapterId: chapterId,
                    overview: chunk.summary, // Map old markdown summary to overview
                    createdAt: legacyBook.createdAt || new Date().toISOString(),
                  },
                  { upsert: true }
                );
              }

              // Create Chapter
              await Chapter.findOneAndUpdate(
                { id: chapterId },
                {
                  id: chapterId,
                  type: "chapter",
                  bookId: legacyBook.id,
                  chapterIndex: chunk.id,
                  title: `Chunk ${chunk.id}`,
                  rawText: chunk.content,
                  summaryId: chunk.summary ? summaryId : null,
                },
                { upsert: true }
              );
              chapterIds.push(chapterId);
            }
          }

          // Save Book
          await Book.findOneAndUpdate(
            { id: legacyBook.id },
            {
              id: legacyBook.id,
              type: "book",
              title: legacyBook.title,
              path: legacyBook.path,
              createdAt: legacyBook.createdAt,
              status: legacyBook.status,
              chapters: chapterIds,
            },
            { upsert: true }
          );
          console.log(`✅ Migrated legacy book: ${legacyBook.title}`);
        }
      }
    } else {
      console.log("⚠️ server/db.json not found, skipping legacy migration.");
    }

    console.log("\n🎉 All migrations complete!");
    console.log("You can now start the server with: npm run dev");
  } catch (err) {
    console.error("\n❌ Migration failed:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

migrate();
