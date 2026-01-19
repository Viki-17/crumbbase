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

async function generateChapterOverview(
  chapterText,
  bookType = "nonfiction",
  onToken
) {
  const isFiction = bookType === "fiction";

  const fictionPrompt = `
    You are an expert literary analyst and storyteller.
    
    TASK:
    Provide a rich, engaging overview of the following chapter from a fiction book.
    Include:
    1. **Plot Summary**: What happens in this chapter? Describe the key events and narrative progression.
    2. **Character Focus**: Which characters appear? What are their motivations, conflicts, or development in this chapter?
    3. **Setting & Atmosphere**: Describe the setting and emotional tone. What mood does the author create?
    4. **Themes & Symbolism**: Identify any themes, motifs, or symbolic elements present.
    5. **Foreshadowing & Tension**: Note any hints about future events or unresolved tensions.
    
    Write in an engaging, narrative style. Format nicely in Markdown.
    
    CHAPTER TEXT:
    "${chapterText.substring(0, 10000)}"
    `;

  const nonfictionPrompt = `
    You are an expert analyst and knowledge synthesizer.
    
    TASK:
    Provide a comprehensive, actionable overview of the following chapter from a non-fiction book.
    Include:
    1. **Core Argument**: What is the main point or thesis of this chapter?
    2. **Key Insights**: What are the most important ideas, concepts, or findings presented?
    3. **Evidence & Examples**: What evidence, case studies, or examples does the author use to support their points?
    4. **Practical Applications**: How can the reader apply these ideas in real life?
    5. **Critical Takeaways**: What should the reader remember from this chapter?
    
    Be concise but thorough. Format nicely in Markdown.
    
    CHAPTER TEXT:
    "${chapterText.substring(0, 10000)}"
    `;

  const prompt = isFiction ? fictionPrompt : nonfictionPrompt;

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

async function generateStructuredSummary(chapterText, bookType = "nonfiction") {
  const isFiction = bookType === "fiction";

  const fictionPrompt = `
    You are an expert literary analyst helping readers understand fiction deeply.

    TASK:
    Summarize the following chapter from a fiction book into a structured JSON object.

    INTERPRETATION GUIDE (same JSON keys, fiction meaning):
    - "mainIdea": The central theme, conflict, or narrative arc of this chapter.
    - "keyConcepts": Key characters, relationships, or plot developments.
    - "examples": Important scenes, dialogues, or pivotal moments.
    - "mentalModels": Symbolic meanings, motifs, or literary devices used.
    - "lifeLessons": Moral insights, character lessons, or universal truths conveyed.

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

  const nonfictionPrompt = `
    You are an expert analyst helping readers extract actionable knowledge from non-fiction.

    TASK:
    Summarize the following chapter from a non-fiction book into a structured JSON object.

    INTERPRETATION GUIDE (non-fiction meaning):
    - "mainIdea": The central argument, thesis, or main point of this chapter.
    - "keyConcepts": Core concepts, frameworks, or ideas introduced.
    - "examples": Case studies, research findings, or real-world examples used.
    - "mentalModels": Thinking frameworks, decision-making tools, or cognitive models presented.
    - "lifeLessons": Actionable advice, practical takeaways, or behavioral recommendations.

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

  const prompt = isFiction ? fictionPrompt : nonfictionPrompt;
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
  // Validate input - log warning if summary is mostly empty
  const hasContent =
    chapterSummaryJSON.mainIdea ||
    (chapterSummaryJSON.keyConcepts &&
      chapterSummaryJSON.keyConcepts.length > 0) ||
    (chapterSummaryJSON.examples && chapterSummaryJSON.examples.length > 0);

  if (!hasContent) {
    console.warn(
      "[AI Service] generateAtomicNotes received empty summary:",
      JSON.stringify(chapterSummaryJSON)
    );
    return [];
  }

  console.log(
    "[AI Service] Generating atomic notes from summary:",
    JSON.stringify(chapterSummaryJSON).substring(0, 200)
  );

  const prompt = `
    You are helping build a personal knowledge base using the Zettelkasten method.

    TASK:
    Convert the structured chapter summary below into atomic knowledge notes.
    Each note should capture ONE key insight, concept, or principle from the summary.

    IMPORTANT:
    - Generate notes ONLY based on the content provided in CHAPTER SUMMARY below.
    - Do NOT generate generic notes about Zettelkasten or note-taking methods.
    - Focus on the actual topics, concepts, and ideas from the summary.

    RULES:
    - Each note must represent ONE independent idea from the summary.
    - Notes must be reusable across contexts.
    - Avoid book-specific phrasing (e.g., "In this chapter...").
    - Keep each note under 120 words.
    - Generate 3-8 notes depending on content richness.
    - Output ONLY valid JSON array.

    JSON FORMAT:
    [
      {
        "title": "String - A clear, descriptive title for the concept",
        "content": "String - The key insight or explanation",
        "tags": ["String - relevant topic tags"]
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
    if (Array.isArray(parsed)) {
      console.log(`[AI Service] Generated ${parsed.length} atomic notes`);
      return parsed;
    }
    if (parsed.notes && Array.isArray(parsed.notes)) {
      console.log(`[AI Service] Generated ${parsed.notes.length} atomic notes`);
      return parsed.notes;
    }
    // Handle single object return
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.title &&
      parsed.content
    ) {
      return [parsed];
    }
    console.warn(
      "[AI Service] generateAtomicNotes returned unexpected format:",
      parsed
    );
    return [];
  } catch (error) {
    console.error("AI Service Error (Notes):", error);
    return [];
  }
}

async function generateOverallAnalysis(allSummaries, bookType = "nonfiction") {
  const combinedText = allSummaries.map((s) => JSON.stringify(s)).join("\n\n");
  const isFiction = bookType === "fiction";

  const fictionPrompt = `
    You are a literary critic synthesizing insights from a complete fiction book.

    TASK:
    Generate an overall book analysis from the chapter summaries.

    FOCUS ON:
    - **Core Themes**: What major themes run through the entire story?
    - **Character Arcs**: How do the main characters evolve from beginning to end?
    - **Narrative Structure**: How does the plot build, climax, and resolve?
    - **Author's Message**: What is the author trying to say about life, society, or humanity?

    RULES:
    - Synthesize across chapters, don't just list them.
    - Capture the emotional and thematic journey.
    - Output ONLY valid JSON.

    JSON FORMAT:
    {
      "coreThemes": ["String"],
      "keyTakeaways": ["String"],
      "mentalModels": ["String"],
      "practicalApplications": ["String"]
    }

    NOTE: For fiction, interpret the fields as:
    - keyTakeaways: Key insights about characters, plot, or meaning
    - mentalModels: Symbolic or thematic frameworks in the story
    - practicalApplications: Life lessons or reflections from the narrative

    CHAPTER SUMMARIES:
    ${combinedText.substring(0, 20000)}
    `;

  const nonfictionPrompt = `
    You are a knowledge synthesizer creating actionable insights from a complete non-fiction book.

    TASK:
    Generate an overall book analysis from the chapter summaries.

    FOCUS ON:
    - **Core Themes**: What recurring ideas appear across chapters?
    - **Key Takeaways**: What are the most important lessons from this book?
    - **Mental Models**: What thinking frameworks or decision-making tools does the author present?
    - **Practical Applications**: How can readers apply these ideas in real life?

    RULES:
    - Focus on recurring ideas across chapters.
    - Do NOT repeat chapter summaries.
    - Capture the author's worldview and philosophy.
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

  const prompt = isFiction ? fictionPrompt : nonfictionPrompt;

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
