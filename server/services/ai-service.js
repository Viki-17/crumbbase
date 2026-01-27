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
  onToken,
  sourceType = null,
) {
  const isFiction = bookType === "fiction";

  // YouTube-specific prompt
  const youtubePrompt = `
    You are an expert content analyst specializing in video content.
    
    TASK:
    Provide a comprehensive overview of the following YouTube video transcript.
    Include:
    1. **Video Summary**: What is this video about? What's the main topic or purpose?
    2. **Key Points**: What are the most important points or insights the presenter shares?
    3. **Speaker Style**: How does the presenter communicate? What's their approach or teaching style?
    4. **Actionable Takeaways**: What can viewers learn or do after watching this video?
    5. **Notable Moments**: Highlight any particularly impactful quotes, demonstrations, or examples.
    
    Write in an engaging style suitable for video content summaries. Format nicely in Markdown.
    
    VIDEO TRANSCRIPT:
    "${chapterText.substring(0, 10000)}"
    `;

  // Blog/Article-specific prompt
  const blogPrompt = `
    You are an expert content analyst specializing in written articles and blog posts.
    
    TASK:
    Provide a comprehensive overview of the following article or blog post.
    Include:
    1. **Article Summary**: What is the main topic and thesis of this article?
    2. **Key Arguments**: What are the author's main points or arguments?
    3. **Evidence & Sources**: What evidence, data, or references does the author cite?
    4. **Author's Perspective**: What stance or viewpoint does the author take?
    5. **Reader Takeaways**: What should readers remember or act on after reading?
    
    Write in a clear, analytical style. Format nicely in Markdown.
    
    ARTICLE TEXT:
    "${chapterText.substring(0, 10000)}"
    `;

  const fictionPrompt = `
    You are an expert literary analyst and storyteller.
    
    TASK:
    Provide a rich, engaging overview of the following chapter from a fiction book.
    
    Start with a **Detailed Chapter Summary** - a flowing, narrative paragraph that captures the essence of what happens in this chapter. This should read like a compelling synopsis that gives the reader a complete understanding of the chapter's content.
    
    Then, include the following structured breakdown:
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
    
    Start with a **Detailed Chapter Summary** - a clear, informative paragraph that captures the central message and key content of this chapter. This should give the reader a complete understanding of what the chapter covers and why it matters.
    
    Then, include the following structured breakdown:
    1. **Core Argument**: What is the main point or thesis of this chapter?
    2. **Key Insights**: What are the most important ideas, concepts, or findings presented?
    3. **Evidence & Examples**: What evidence, case studies, or examples does the author use to support their points?
    4. **Practical Applications**: How can the reader apply these ideas in real life?
    5. **Critical Takeaways**: What should the reader remember from this chapter?
    
    Be concise but thorough. Format nicely in Markdown.
    
    CHAPTER TEXT:
    "${chapterText.substring(0, 10000)}"
    `;

  // Select prompt based on sourceType first, then bookType
  let prompt;
  if (sourceType === "youtube") {
    prompt = youtubePrompt;
  } else if (sourceType === "blog") {
    prompt = blogPrompt;
  } else {
    prompt = isFiction ? fictionPrompt : nonfictionPrompt;
  }

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

async function generateStructuredSummary(
  chapterText,
  bookType = "nonfiction",
  sourceType = null,
) {
  const isFiction = bookType === "fiction";

  // YouTube-specific prompt
  const youtubePrompt = `
    You are an expert content analyst specializing in video content.

    TASK:
    Summarize the following YouTube video transcript into a structured JSON object.

    INTERPRETATION GUIDE (video content meaning):
    - "mainIdea": The central topic, message, or purpose of this video.
    - "keyConcepts": Key topics, techniques, or skills covered in the video.
    - "examples": Demonstrations, case studies, or examples shown by the presenter.
    - "mentalModels": Frameworks, methodologies, or approaches taught in the video.
    - "lifeLessons": Practical tips, advice, or actionable steps for viewers.

    RULES:
    - Do NOT add information not present in the transcript.
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

    VIDEO TRANSCRIPT:
    "${chapterText.substring(0, 15000)}" 
    `;

  // Blog/Article-specific prompt
  const blogPrompt = `
    You are an expert content analyst specializing in written articles and blog posts.

    TASK:
    Summarize the following article or blog post into a structured JSON object.

    INTERPRETATION GUIDE (article content meaning):
    - "mainIdea": The central thesis, argument, or main point of this article.
    - "keyConcepts": Key ideas, concepts, or themes explored in the article.
    - "examples": Data, research, case studies, or real-world examples cited.
    - "mentalModels": Frameworks, perspectives, or analytical approaches presented.
    - "lifeLessons": Practical advice, recommendations, or conclusions for readers.

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

    ARTICLE TEXT:
    "${chapterText.substring(0, 15000)}" 
    `;

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

  // Select prompt based on sourceType first, then bookType
  let prompt;
  if (sourceType === "youtube") {
    prompt = youtubePrompt;
  } else if (sourceType === "blog") {
    prompt = blogPrompt;
  } else {
    prompt = isFiction ? fictionPrompt : nonfictionPrompt;
  }
  console.log(
    "[AI Service] Generating structured summary (with retry capability)...",
  );

  let attempts = 0;
  const maxAttempts = 3;

  console.log(
    chapterText.substring(0, 15000),
    "=====================================",
    chapterText,
  );

  while (attempts < maxAttempts) {
    attempts++;
    try {
      console.log(
        `[AI Service] Attempt ${attempts}/${maxAttempts} for structured summary...`,
      );
      const response = await ollama.chat({
        model: "gemma3:4b",
        messages: [{ role: "user", content: prompt }],
        format: "json",
        stream: false,
      });
      console.log("response", response);

      console.log(
        "[AI Service] Raw AI Response:",
        response.message.content.substring(0, 500), // Log first 500 chars for debugging
      );

      const parsed = JSON.parse(response.message.content);
      console.log(
        "[AI Service] Structured summary response:",
        JSON.stringify(parsed).substring(0, 300),
      );

      // Validate the response has required fields
      if (
        !parsed.mainIdea &&
        (!parsed.keyConcepts || parsed.keyConcepts.length === 0)
      ) {
        console.warn(
          `[AI Service] Structured summary attempt ${attempts} missing required fields:`,
          parsed,
        );
        if (attempts === maxAttempts) {
          throw new Error(
            "AI returned invalid structured summary after multiple attempts - missing mainIdea and keyConcepts",
          );
        }
        continue; // Retry
      }

      return parsed;
    } catch (error) {
      console.warn(
        `[AI Service] Structured summary attempt ${attempts} failed:`,
        error.message,
      );
      if (attempts === maxAttempts) {
        console.error("AI Service Error (Summary):", error);
        throw error;
      }
      // Small delay before retry
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
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
      JSON.stringify(chapterSummaryJSON),
    );
    return [];
  }

  console.log(
    "[AI Service] Generating atomic notes from summary:",
    JSON.stringify(chapterSummaryJSON).substring(0, 200),
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
      parsed,
    );
    return [];
  } catch (error) {
    console.error("AI Service Error (Notes):", error);
    return [];
  }
}

async function generateOverallAnalysis(
  allSummaries,
  bookType = "nonfiction",
  sourceType = null,
) {
  const combinedText = allSummaries.map((s) => JSON.stringify(s)).join("\n\n");
  const isFiction = bookType === "fiction";

  // YouTube-specific prompt
  const youtubePrompt = `
    You are an expert content synthesizer analyzing a complete YouTube video or video series.

    TASK:
    Generate an overall analysis from the video segment summaries.

    FOCUS ON:
    - **Core Topics**: What are the main topics or themes covered across the video?
    - **Key Takeaways**: What are the most valuable insights for viewers?
    - **Skills & Techniques**: What skills, methods, or techniques are taught?
    - **Practical Applications**: How can viewers apply what they learned?

    RULES:
    - Synthesize across segments, don't just list them.
    - Focus on actionable value for viewers.
    - Output ONLY valid JSON.

    JSON FORMAT:
    {
      "coreThemes": ["String"],
      "keyTakeaways": ["String"],
      "mentalModels": ["String"],
      "practicalApplications": ["String"]
    }

    VIDEO SUMMARIES:
    ${combinedText.substring(0, 20000)}
    `;

  // Blog/Article-specific prompt
  const blogPrompt = `
    You are an expert content synthesizer analyzing a complete article or blog post series.

    TASK:
    Generate an overall analysis from the article section summaries.

    FOCUS ON:
    - **Core Arguments**: What are the main arguments or theses presented?
    - **Key Insights**: What are the most important points for readers?
    - **Frameworks & Perspectives**: What analytical frameworks or viewpoints are introduced?
    - **Reader Actions**: What should readers do or think differently after reading?

    RULES:
    - Synthesize across sections, don't just list them.
    - Capture the author's overall message and perspective.
    - Output ONLY valid JSON.

    JSON FORMAT:
    {
      "coreThemes": ["String"],
      "keyTakeaways": ["String"],
      "mentalModels": ["String"],
      "practicalApplications": ["String"]
    }

    ARTICLE SUMMARIES:
    ${combinedText.substring(0, 20000)}
    `;

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

  // Select prompt based on sourceType first, then bookType
  let prompt;
  if (sourceType === "youtube") {
    prompt = youtubePrompt;
  } else if (sourceType === "blog") {
    prompt = blogPrompt;
  } else {
    prompt = isFiction ? fictionPrompt : nonfictionPrompt;
  }

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

async function generateFolderStructure(
  allNotes,
  onProgress = null,
  existingFolders = null,
) {
  let folderNames = [];

  // 1. Determine Logic: Start Fresh or Resume
  if (
    existingFolders &&
    Array.isArray(existingFolders) &&
    existingFolders.length > 0
  ) {
    console.log(
      `[AI Service] Resuming folder organization with ${existingFolders.length} existing folders.`,
    );
    // Extract names from existing folders
    folderNames = existingFolders
      .map((f) => f.name)
      .filter((n) => n !== "Uncategorized");

    // If for some reason names are empty (edge case), strictly fallback or just use what we have
    if (folderNames.length === 0) {
      // Should rarely happen if length > 0, but maybe only "Uncategorized" exists?
      // Fallback to generating new ones if truly empty
      console.log(
        "[AI Service] Existing folders were empty or only Uncategorized. Generating new taxonomy.",
      );
    }
  }

  // Generate Taxonomy ONLY if we didn't get valid names from existing folders
  if (folderNames.length === 0) {
    console.log(
      `[AI Service] Generating folder taxonomy for ${allNotes.length} notes...`,
    );

    // Extract titles for taxonomy generation (limit to 100 random titles if too many to avoid context blowout)
    const MAX_TITLES_FOR_TAXONOMY = 100;
    const titlesForTaxonomy = allNotes
      .map((n) => n.title)
      .sort(() => 0.5 - Math.random()) // Shuffle
      .slice(0, MAX_TITLES_FOR_TAXONOMY);

    const taxonomyPrompt = `
      You are an expert knowledge architect.
      
      TASK:
      Create a set of 8-12 distinct, high-level folder names to organize a personal knowledge base.
      Base the categories on the sample note titles provided below.
      
      RULES:
      - Folders must be mutually exclusive and collectively exhaustive where possible.
      - Use clear, professional names (e.g., "Productivity", "Mental Models", "Technology").
      - Return ONLY a JSON array of strings.
      
      SAMPLE TITLES:
      ${JSON.stringify(titlesForTaxonomy)}
    `;

    try {
      const response = await ollama.chat({
        model: "gemma3:4b",
        messages: [{ role: "user", content: taxonomyPrompt }],
        format: "json",
        stream: false,
      });

      // Handle potential object wrapper { "folders": [...] } or direct array
      const parsed = JSON.parse(response.message.content);
      if (Array.isArray(parsed)) {
        folderNames = parsed;
      } else if (parsed.folders && Array.isArray(parsed.folders)) {
        folderNames = parsed.folders;
      } else {
        // Fallback
        folderNames = ["General", "Concepts", "Projects", "Archive"];
      }
      console.log(`[AI Service] Generated taxonomy: ${folderNames.join(", ")}`);
    } catch (error) {
      console.error("Failed to generate taxonomy, using default", error);
      folderNames = [
        "General",
        "Mental Models",
        "Technology",
        "Health",
        "Business",
        "Philosophy",
      ];
    }
  } else {
    console.log(
      `[AI Service] Used existing taxonomy: ${folderNames.join(", ")}`,
    );
  }

  // 2. Prepare for Assignment
  const finalFolders = {}; // Map<FolderName, NoteID[]>

  // Initialize with existing data if resuming
  if (existingFolders) {
    existingFolders.forEach((f) => {
      finalFolders[f.name] = [...(f.noteIds || [])];
    });
  }

  // Ensure all taxonomy folder names exist in the map
  folderNames.forEach((name) => {
    if (!finalFolders[name]) finalFolders[name] = [];
  });
  // Ensure Uncategorized exists
  if (!finalFolders["Uncategorized"]) finalFolders["Uncategorized"] = [];

  // Filter notes that are already processed
  const processedNoteIds = new Set();
  Object.values(finalFolders).forEach((ids) => {
    ids.forEach((id) => processedNoteIds.add(id));
  });

  const notesToProcess = allNotes.filter((n) => !processedNoteIds.has(n.id));

  if (notesToProcess.length === 0) {
    console.log(
      "[AI Service] All notes are already organized. Organization job complete.",
    );
    // Return current state immediately
    return {
      folders: Object.entries(finalFolders)
        .filter(([_, ids]) => ids.length > 0)
        .map(([name, ids]) => ({
          name,
          noteIds: ids,
        })),
    };
  }

  // 3. Assign Notes to Folders in Batches
  const BATCH_SIZE = 20;
  const totalBatches = Math.ceil(notesToProcess.length / BATCH_SIZE);

  console.log(
    `[AI Service] Processing ${notesToProcess.length} remaining notes in ${totalBatches} batches...`,
  );

  for (let i = 0; i < notesToProcess.length; i += BATCH_SIZE) {
    const batch = notesToProcess.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    console.log(
      `[AI Service] Processing batch ${batchNumber} of ${totalBatches}...`,
    );

    const batchPrompt = `
      TASK:
      Assign each of the following notes to ONE of the provided folders.
      
      FOLDERS:
      ${JSON.stringify(folderNames)}
      
      NOTES:
      ${JSON.stringify(batch.map((n) => ({ id: n.id, title: n.title, glimpse: n.content?.substring(0, 50) })))}
      
      RULES:
      - Use ONLY the provided folder names.
      - If a note fits nowhere, use null or omit it.
      - Output JSON format: { "assignments": [ { "id": "noteId", "folder": "folderName" } ] }
    `;

    const attemptBatch = async (retryCount = 0) => {
      try {
        console.log(
          `[AI Service] Batch ${batchNumber} attempt ${retryCount + 1}...`,
        );
        const response = await ollama.chat({
          model: "gemma3:4b",
          messages: [{ role: "user", content: batchPrompt }],
          format: "json",
          stream: false,
        });

        const parsed = JSON.parse(response.message.content);
        const assignments = parsed.assignments || [];

        // Process assignments
        const batchIds = new Set(batch.map((n) => n.id));

        assignments.forEach((a) => {
          if (batchIds.has(a.id) && finalFolders[a.folder]) {
            finalFolders[a.folder].push(a.id);
            batchIds.delete(a.id); // Mark as handled
          }
        });

        // Any remaining go to Uncategorized
        batchIds.forEach((id) => finalFolders["Uncategorized"].push(id));
      } catch (err) {
        if (retryCount < 2) {
          console.warn(
            `[AI Service] Batch failed, retrying (${retryCount + 1}/2)... Error: ${err.message}`,
          );
          await new Promise((r) => setTimeout(r, 2000)); // Wait 2s
          await attemptBatch(retryCount + 1);
        } else {
          console.error(
            `[AI Service] Batch failed finally, moving to Uncategorized`,
            err,
          );
          batch.forEach((n) => finalFolders["Uncategorized"].push(n.id));
        }
      }
    };

    await attemptBatch();

    // Call progress callback after each batch
    if (onProgress) {
      const currentFolders = Object.entries(finalFolders)
        .filter(([_, ids]) => ids.length > 0)
        .map(([name, ids]) => ({ name, noteIds: ids }));

      await onProgress({
        batchNumber,
        totalBatches,
        folders: currentFolders,
      });
    }
  }

  // 4. Format Output
  const result = {
    folders: Object.entries(finalFolders)
      .filter(([_, ids]) => ids.length > 0)
      .map(([name, ids]) => ({
        name,
        noteIds: ids,
      })),
  };

  return result;
}

module.exports = {
  generateChapterOverview,
  generateStructuredSummary,
  generateAtomicNotes,
  generateOverallAnalysis,
  explainLinkRelationship,
  generateFolderStructure,
};
