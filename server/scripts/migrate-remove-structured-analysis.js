require("dotenv").config({ path: __dirname + "/../../.env" });
const mongoose = require("mongoose");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/project-book";

async function runMigration() {
  console.log("Starting database migration to remove structured analysis...");
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB.");

    const db = mongoose.connection.db;

    console.log("1. Removing 'analysisStatus' from Chapters...");
    const chapterResult = await db.collection("chapters").updateMany(
      { analysisStatus: { $exists: true } },
      { $unset: { analysisStatus: "" } }
    );
    console.log(`Updated ${chapterResult.modifiedCount} chapters.`);

    console.log("2. Removing structured fields from Summaries...");
    const summaryResult = await db.collection("summaries").updateMany(
      {
        $or: [
          { mainIdea: { $exists: true } },
          { keyConcepts: { $exists: true } },
          { examples: { $exists: true } },
          { mentalModels: { $exists: true } },
          { lifeLessons: { $exists: true } },
        ],
      },
      {
        $unset: {
          mainIdea: "",
          keyConcepts: "",
          examples: "",
          mentalModels: "",
          lifeLessons: "",
        },
      }
    );
    console.log(`Updated ${summaryResult.modifiedCount} summaries.`);

    console.log("Migration completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

runMigration();
