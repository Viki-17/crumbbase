const { extractTextFromPDF, splitIntoChapters } = require("./pdf-processor");
const { summarizeChapter } = require("./summarizer");
const path = require("path");

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: node src/index.js <path-to-pdf>");
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);

  console.log(`Processing: ${absolutePath}`);
  console.log("Extracting text...");

  let text;
  try {
    text = await extractTextFromPDF(absolutePath);
  } catch (err) {
    console.error(`Error reading PDF: ${err.message}`);
    process.exit(1);
  }

  console.log("Splitting into chapters/chunks...");
  const chunks = splitIntoChapters(text);
  console.log(`Found ${chunks.length} chunks to process.`);

  for (let i = 0; i < chunks.length; i++) {
    console.log(`\n--- Processing Chunk ${i + 1}/${chunks.length} ---`);
    try {
      const summary = await summarizeChapter(chunks[i], "gemma3:4b");
      console.log(`\n=== Chunk ${i + 1} Summary ===\n`);
      console.log(summary);
      console.log("\n==============================\n");
    } catch (err) {
      console.error(`Failed to summarize chunk ${i + 1}: ${err.message}`);
    }
  }

  console.log("Book processing complete.");
}

main();
