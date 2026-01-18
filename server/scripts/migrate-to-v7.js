/**
 * Schema Migration Script: V6 -> V7
 *
 * Usage: node server/scripts/migrate-to-v7.js
 *
 * This script updates existing documents to match the V7 schema:
 * 1. Backfills `status`, `lastStep`, `retryCount`, `error` for Chapters.
 * 2. Initializes the `Folder` metadata document if not present.
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const mongoose = require("mongoose");
const { Chapter, Folder, Summary, Note } = require("../models");

async function migrate() {
  console.log("Starting V7 Schema Migration...");
  console.log(`Connecting to: ${process.env.MONGODB_URI}`);

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB connected");

    // --- 1. Backfill Chapters ---
    console.log("\n--- Backfilling Chapters ---");
    const chapters = await Chapter.find({});
    console.log(`Found ${chapters.length} chapters.`);

    for (const chap of chapters) {
      const updates = {};
      let needsUpdate = false;

      // Determine logical status based on existing data
      // If summary exists, it's at least past summarization
      // If atomic notes exist for this chapter, it's likely completed or close

      const summary = await Summary.findOne({ chapterId: chap.id });
      const notes = await Note.findOne({ "source.chapterId": chap.id });

      if (!chap.status || chap.status === "processing") {
        // Default was processing in V5/V6 implies incomplete? Or just lack of field.
        // Actually V6 didn't have status on Chapter, only Book had status.
        // So chap.status might be undefined.

        if (notes) {
          updates.status = "completed";
          updates.lastStep = "atomic_notes";
        } else if (summary) {
          updates.status = "atomic_notes"; // Ready for notes
          updates.lastStep = "summarization";
        } else if (chap.rawText) {
          updates.status = "summarization"; // Ready for summary
          updates.lastStep = "extraction";
        } else {
          updates.status = "pending";
        }
        needsUpdate = true;
      }

      if (chap.retryCount === undefined) {
        updates.retryCount = 0;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await Chapter.updateOne({ _id: chap._id }, { $set: updates });
        console.log(`Updated Chapter ${chap.chapterIndex}: ${updates.status}`);
      }
    }

    // --- 2. Initialize Folder Metadata ---
    console.log("\n--- Initializing Folder Structure ---");
    const folderDoc = await Folder.findOne({ id: "folder-metadata" });
    if (!folderDoc) {
      await Folder.create({
        id: "folder-metadata",
        folders: [],
      });
      console.log("✅ Created empty folder-metadata document.");
    } else {
      console.log("ℹ️ Folder metadata already exists.");
    }

    console.log("\n🎉 V7 Migration complete!");
  } catch (err) {
    console.error("\n❌ Migration failed:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

migrate();
