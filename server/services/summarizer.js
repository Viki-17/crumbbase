const ollama = require("./ollama-client");

async function summarizeChapter(text, model = "gemma3:4b", onToken) {
  const prompt = `
    You are an expert at analyzing books and extracting knowledge.
    
    Here is a chapter (or section) from a book:
    
    "${text}"
    
    Please provide:
    1. A concise **Summary** of the chapter (2-3 paragraphs).
    2. **Key Points** extracted as bullet points.
    3. **Mental Models**: Identify any mental models, frameworks, or core concepts introduced or used in this section. Explain them briefly.
    
    Format the output in Markdown.
    `;

  try {
    const response = await ollama.chat({
      model: model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });

    let fullContent = "";
    for await (const part of response) {
      const token = part.message.content;
      fullContent += token;
      if (onToken) {
        onToken(token);
      }
    }
    return fullContent;
  } catch (error) {
    console.error("Error communicating with Ollama:", error);
    throw error;
  }
}

async function analyzeBook(chunkSummaries, model = "gemma3:4b", onToken) {
  // Combine summaries into a meta-summary prompt
  const combinedText = chunkSummaries
    .map((s, i) => `Chapter ${i + 1} Summary:\n${s}`)
    .join("\n\n");

  const prompt = `
    You are an expert at synthesizing complex information.
    
    Here are the summaries of every chapter in a book:
    
    ${combinedText}
    
    Based on these chapter summaries, please provide a **Comprehensive Book Analysis**:
    
    1. **Overall Summary**: The big picture narrative or argument of the book.
    2. **Core Themes**: The major recurring themes across chapters.
    3. **Key Mental Models**: The most important frameworks or concepts the reader should take away.
    4. **Actionable Takeaways**: Practical applications of the book's ideas.
    
    Format the output in Markdown.
    `;

  try {
    const response = await ollama.chat({
      model: model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });

    let fullContent = "";
    for await (const part of response) {
      const token = part.message.content;
      fullContent += token;
      if (onToken) {
        onToken(token);
      }
    }
    return fullContent;
  } catch (error) {
    console.error("Error communicating with Ollama for book analysis:", error);
    throw error;
  }
}

module.exports = {
  summarizeChapter,
  analyzeBook,
};
