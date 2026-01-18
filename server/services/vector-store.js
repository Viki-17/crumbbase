const storage = require("./storage");
const ollama = require("./ollama-client");
const { Note } = require("../models"); // Direct access for vector search optimization

// Simple cosine similarity
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// V7: Fully Async Vector Store (DB Backed)

async function findSimilar(targetEmbedding, limit = 5, excludeId = null) {
  // Fetch all notes with embeddings
  // Optimization: In a real prod env, use MongoDB Atlas Vector Search or similar.
  // For local use with < 10k notes, scanning all embeddings in JS memory is acceptable but fetching them is slow.
  // We will fetch only id, title, and embedding fields.

  await storage.connectDB();
  const notes = await Note.find(
    { embedding: { $exists: true, $ne: [] } },
    { id: 1, title: 1, embedding: 1 }
  ).lean();

  const scores = notes
    .filter((item) => item.id !== excludeId)
    .map((item) => ({
      id: item.id,
      title: item.title,
      score: cosineSimilarity(targetEmbedding, item.embedding),
    }));

  // Sort desc
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, limit);
}

// Kept for compatibility but now empty/no-op as we fetch from DB
function addNoteToCache(note) {
  // No-op
}

async function suggestLinks(newNote) {
  if (!newNote.embedding) return [];

  // 1. Retrieval
  const candidates = await findSimilar(newNote.embedding, 5, newNote.id);
  if (candidates.length === 0) return [];

  // 2. Validation with LLM (Auto Link Suggestion Prompt)
  // We need the content of candidates to verify.
  const candidateNotes = [];
  for (const c of candidates) {
    const n = await storage.getNote(c.id);
    if (n) candidateNotes.push(n);
  }

  const prompt = `
    You are helping suggest conceptual links in a personal knowledge graph.

    TASK:
    Given a target knowledge note and a list of candidate notes, suggest which ones are meaningfully related.

    RULES:
    - Only suggest links with clear conceptual overlap.
    - If no strong relationship exists, return an empty array.
    - Explain the reason for each suggestion.
    - Output ONLY valid JSON.

    JSON FORMAT:
    [
      {
        "noteId": "uuid",
        "reason": "explanation...",
        "confidence": 0.0 to 1.0
      }
    ]

    TARGET NOTE:
    ${JSON.stringify({ title: newNote.title, content: newNote.content })}

    CANDIDATE NOTES:
    ${JSON.stringify(
      candidateNotes.map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content,
      }))
    )}
    `;

  try {
    const response = await ollama.chat({
      model: "gemma3:4b", // Using users preferred model or default
      messages: [{ role: "user", content: prompt }],
      format: "json",
      stream: false,
    });

    const suggestions = JSON.parse(response.message.content);
    // Normalize output
    let links = [];
    if (Array.isArray(suggestions)) links = suggestions;
    else if (suggestions.links) links = suggestions.links;

    // Map back to expected structure if needed, ensure noteId is present
    return links
      .filter((l) => l.noteId && l.confidence > 0.5)
      .map((l) => ({
        toId: l.noteId,
        reason: l.reason,
        confidence: l.confidence,
      }));
  } catch (error) {
    console.error("Vector Store Link Suggestion Error:", error);
    return [];
  }
}

module.exports = {
  addNoteToCache,
  findSimilar,
  suggestLinks,
};
