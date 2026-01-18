const ollama = require("./ollama-client");

async function generateEmbedding(text) {
  try {
    const response = await ollama.embeddings({
      model: "nomic-embed-text",
      prompt: text,
    });
    return response.embedding;
  } catch (error) {
    console.error("Embedding Service Error:", error);
    // Fallback or retry?
    // For now throw, as embeddings are critical for V3
    throw error;
  }
}

module.exports = {
  generateEmbedding,
};
