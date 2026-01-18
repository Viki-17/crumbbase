const ollama = require("./ollama-client");

// Helper to extract JSON from markdown code block
function parseJSON(text) {
  try {
    // Try parsing directly
    return JSON.parse(text);
  } catch (e) {
    // Try extracting from ```json ... ```
    const match = text.match(/```json([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (e2) {
        console.error("Failed to parse extracted JSON", e2);
      }
    }
    // Fallback: try finding first { and last }
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1) {
      try {
        return JSON.parse(text.substring(first, last + 1));
      } catch (e3) {
        console.error("Failed to parse fuzzy JSON", e3);
      }
    }
    return null;
  }
}

async function generateChapterOverview(chapterText, onToken) {
  const prompt = `
    You are an expert storyteller and analyst.
    
    TASK:
    Provide a comprehensive, engaging overview of the following chapter.
    Include:
    1. A Narrative Summary of what happens.
    2. Key Characters involved.
    3. Essential Lessons or Takeaways.
    
    Format nicely in Markdown.
    
    CHAPTER TEXT:
    "${chapterText.substring(0, 10000)}"
    `;

  try {
    const response = await ollama.chat({
      model: "gemma3:4b",
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
    console.error("AI Service Error (Overview):", error);
    throw error;
  }
}

async function generateStructuredSummary(chapterText) {
  const prompt = `
    You are an assistant that summarizes book chapters into structured knowledge.

    TASK:
    Summarize the following chapter into a structured JSON object.

    RULES:
    - Do NOT add information not present in the text.
    - Be concise and meaningful.
    - If a section is not applicable, return an empty array.
    - Output ONLY valid JSON.

    JSON FORMAT:
    {
      "mainIdea": "String",
      "keyConcepts": ["String"],
      "examples": ["String"],
      "mentalModels": ["String"],
      "lifeLessons": ["String"]
    }

    CHAPTER TEXT:
    "${chapterText.substring(0, 15000)}" 
    `;
  console.log("prompt", prompt);
  try {
    const response = await ollama.chat({
      model: "gemma3:4b",
      messages: [{ role: "user", content: prompt }],
      format: "json",
      stream: false,
    });
    console.log(response);
    return JSON.parse(response.message.content);
  } catch (error) {
    console.error("AI Service Error (Summary):", error);
    throw error;
  }
}

async function generateAtomicNotes(chapterSummaryJSON) {
  const prompt = `
    You are helping build a personal knowledge base using the Zettelkasten method.

    TASK:
    Convert the structured chapter summary into atomic knowledge notes.

    RULES:
    - Each note must represent ONE independent idea.
    - Notes must be reusable across contexts.
    - Avoid book-specific phrasing (e.g., "In this chapter...").
    - Keep each note under 120 words.
    - Output ONLY valid JSON array.

    JSON FORMAT:
    [
      {
        "title": "String",
        "content": "String",
        "tags": ["String"]
      }
    ]

    CHAPTER SUMMARY:
    ${JSON.stringify(chapterSummaryJSON)}
    `;

  try {
    const response = await ollama.chat({
      model: "gemma3:4b",
      messages: [{ role: "user", content: prompt }],
      format: "json",
      stream: false,
    });

    const parsed = JSON.parse(response.message.content);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.notes && Array.isArray(parsed.notes)) return parsed.notes;
    // Handle single object return
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.title &&
      parsed.content
    ) {
      return [parsed];
    }
    return [];
  } catch (error) {
    console.error("AI Service Error (Notes):", error);
    return [];
  }
}

async function generateOverallAnalysis(allSummaries) {
  const combinedText = allSummaries.map((s) => JSON.stringify(s)).join("\n\n");

  const prompt = `
    You are synthesizing a complete book from chapter-level knowledge.

    TASK:
    Generate an overall book summary from the chapter summaries.

    RULES:
    - Focus on recurring ideas across chapters.
    - Do NOT repeat chapter summaries.
    - Capture the author's worldview.
    - Output ONLY valid JSON.

    JSON FORMAT:
    {
      "coreThemes": ["String"],
      "keyTakeaways": ["String"],
      "mentalModels": ["String"],
      "practicalApplications": ["String"]
    }

    CHAPTER SUMMARIES:
    ${combinedText.substring(0, 20000)}
    `;

  try {
    const response = await ollama.chat({
      model: "gemma3:4b",
      messages: [{ role: "user", content: prompt }],
      format: "json",
      stream: false,
    });
    return JSON.parse(response.message.content);
  } catch (error) {
    console.error("AI Service Error (Analysis):", error);
    throw error;
  }
}

async function explainLinkRelationship(noteA, noteB) {
  const prompt = `
You are helping a user connect ideas in a personal knowledge graph.

TASK:
Explain the conceptual relationship between the following two atomic knowledge notes.

RULES:
- Focus on ideas, not wording or structure.
- Do NOT invent connections that are not clearly supported.
- If no meaningful relationship exists, explicitly say so.
- Keep the explanation under 100 words.
- Output plain text only.

NOTE A:
${JSON.stringify(noteA)}

NOTE B:
${JSON.stringify(noteB)}
  `;

  try {
    const response = await ollama.chat({
      model: "gemma3:4b",
      messages: [{ role: "user", content: prompt }],
      stream: false,
    });
    return response.message.content.trim();
  } catch (error) {
    console.error("AI Service Error (Link Explanation):", error);
    throw error;
  }
}

async function generateFolderStructure(allNotes) {
  // OPTIMIZATION: If notes > 50, use title-only context to save tokens and avoid overflow
  const isLargeSet = allNotes.length > 50;

  const notesLite = allNotes.map((n) => {
    if (isLargeSet) {
      return { id: n.id, title: n.title };
    }
    return {
      id: n.id,
      title: n.title,
      // Reduced content length for context
      content: n.content ? n.content.substring(0, 150) : "",
    };
  });

  const prompt = `
    You are organizing a personal knowledge base.

    TASK:
    Group the following knowledge notes into meaningful folders based on thematic similarity.
    ${
      isLargeSet
        ? "Note: You are provided with titles only due to volume. Infer themes from titles."
        : ""
    }

    RULES:
    - Each folder must represent a clear theme.
    - A note should belong to only ONE folder.
    - Folder names should be short and descriptive (e.g., "Mental Models", "Productivity", "History").
    - Do NOT force grouping if concepts are unrelated.
    - Output ONLY valid JSON.

    JSON FORMAT:
    {
      "folders": [
        {
          "name": "String",
          "noteIds": ["uuid"]
        }
      ]
    }

    NOTES:
    ${JSON.stringify(notesLite)}
  `;

  try {
    const response = await ollama.chat({
      model: "gemma3:4b", // or user configured model
      messages: [{ role: "user", content: prompt }],
      format: "json",
      stream: false,
    });
    return JSON.parse(response.message.content);
  } catch (error) {
    console.error("AI Service Error (Folders):", error);
    throw error;
  }
}

module.exports = {
  generateChapterOverview,
  generateStructuredSummary,
  generateAtomicNotes,
  generateOverallAnalysis,
  explainLinkRelationship,
  generateFolderStructure,
};
