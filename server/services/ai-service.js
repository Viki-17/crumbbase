const opencode = require("./opencode-client");

// Reusable function for AI generation via the OpenCode server.
// All prompts are routed through opencode-client which talks to a sidecar
// `opencode serve` process using the opencode-go provider models:
//   - "pro"   => opencode-go/muse-spark-1.3-contributor (heavy: summaries, notes, analysis)
//   - "flash" => opencode-go/muse-spark-1.3-contributor (light: link explanation, ask AI)
// Tiers are overridable via OPENCODE_PRO_MODEL / OPENCODE_FLASH_MODEL in .env.

async function generateChapterOverview(
  chapterText,
  bookType = "nonfiction",
  onToken,
  sourceType = null,
) {
  const isFiction = bookType === "fiction";

  // YouTube-specific prompt
  const youtubePrompt = `
    You are an expert content analyst and deep-learning comprehension specialist specializing in video content.
    
    TASK:
    Provide a highly detailed, comprehensive, and actionable overview of the following YouTube video transcript. Do NOT provide shallow, surface-level bullet points. Your goal is to extract maximum value for the reader by explaining concepts, analogies, examples, and arguments in profound detail.
    
    Start with a **Comprehensive Video Summary** - a deep, informative narrative that captures the central message, the nuances of the video's arguments, and the key narrative flow. This should give the reader a complete, rich understanding of what the video covers, avoiding generic summaries.
    
    Then, include the following structured breakdown. For each section, go into EXTREME detail, providing context, explaining the mechanics of the concepts, and breaking down complex ideas so the reader fully understands them without watching the video:
    
    1. **Deep Dive into Key Concepts & Arguments**: Detail the most important points, concepts, or arguments presented. Do not just list them; explain the mechanics of each concept (e.g., if a specific term or practice is mentioned, explain exactly what it is, how it works, and why it matters).
    2. **Comprehensive Evidence, Examples & Demonstrations**: Thoroughly break down the evidence, case studies, or examples used in the video. You MUST explain these examples fully to illustrate the key concepts clearly.
    3. **Actionable & Specific Takeaways**: What can viewers learn or do after watching this video? Provide specific, step-by-step actionable advice or concrete behavioral changes the viewer can implement.
    4. **Critical Quotes & Notable Moments**: Highlight the most impactful quotes, definitive statements, or critical moments from the transcript. Provide the context for why these moments are significant.
    
    Prioritize depth, thoroughness, and maximum value extraction over conciseness. Do NOT use Markdown tables; use bullet points, bold text, or standard paragraphs instead. Format nicely in Markdown.
    
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
    
    Write in a clear, analytical style. Do NOT use Markdown tables; use bullet points, bold text, or standard paragraphs instead. Format nicely in Markdown.
    
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
    
    Write in an engaging, narrative style. Do NOT use Markdown tables; use bullet points, bold text, or standard paragraphs instead. Format nicely in Markdown.
    
    CHAPTER TEXT:
    "${chapterText.substring(0, 10000)}"
    `;

  const nonfictionPrompt = `
    You are an expert literary analyst, deep-reading comprehension specialist, and knowledge synthesizer.
    
    TASK:
    Provide a highly detailed, comprehensive, and actionable overview of the following chapter from a non-fiction book. Do NOT provide shallow, surface-level bullet points. Your goal is to extract maximum value for the reader by explaining concepts, analogies, thought experiments, and evidence in profound detail.
    
    Start with a **Comprehensive Chapter Summary** - a deep, informative narrative that captures the central message, the nuances of the author's argument, and the key narrative flow of this chapter. This should give the reader a complete, rich understanding of what the chapter covers, avoiding generic summaries.
    
    Then, include the following structured breakdown. For each section, go into EXTREME detail, providing context, explaining the mechanics of the concepts, and breaking down complex ideas:
    
    1. **Core Argument & Philosophical Foundation**: What is the definitive main thesis of this chapter? Explain the underlying logic and foundational premises the author builds upon.
    2. **Deep Dive into Key Insights**: Detail the most important ideas, concepts, or findings presented. Do not just list them; explain the mechanics of each insight, why it matters, and how it challenges conventional thinking.
    3. **Comprehensive Evidence, Analogies & Thought Experiments**: Thoroughly break down the evidence, case studies, thought experiments, or analogies used by the author. You MUST explain these examples fully (e.g., if an analogy or specific thought experiment is mentioned, explain exactly what it represents, the context in which it was introduced, and its broader implications).
    4. **Actionable & Specific Practical Applications**: How can the reader apply these ideas in real life? Provide specific, step-by-step actionable advice, detailed scenarios, or behavioral changes the reader can implement based on the text.
    5. **Critical Takeaways & Nuances**: What are the most profound lessons to remember? Include the nuances, caveats, and any potential counter-arguments the author addresses.
    
    Prioritize depth, thoroughness, and maximum value extraction over conciseness. The reader should feel they have deeply understood the chapter's intricacies without having to read it themselves. Do NOT use Markdown tables; use bullet points, bold text, or standard paragraphs instead. Format nicely in Markdown.
    
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
    const fullText = await opencode.generate(prompt, "pro");
    if (onToken) onToken(fullText);
    return fullText;
  } catch (error) {
    console.error("AI Service Error (Overview):", error);
    throw error;
  }
}

async function generateAtomicNotes(chapterOverview) {
  if (
    !chapterOverview ||
    typeof chapterOverview !== "string" ||
    chapterOverview.trim() === ""
  ) {
    console.warn("[AI Service] generateAtomicNotes received empty overview");
    return [];
  }

  console.log(
    "[AI Service] Generating atomic notes from overview:",
    chapterOverview.substring(0, 200),
  );

  const prompt = `
    You are helping build a personal knowledge base using the Zettelkasten method.

    TASK:
    Convert the chapter overview below into atomic knowledge notes.
    Each note should capture ONE key insight, concept, or principle from the overview.

    IMPORTANT:
    - Generate notes ONLY based on the content provided in CHAPTER OVERVIEW below.
    - Do NOT generate generic notes about Zettelkasten or note-taking methods.
    - Focus on the actual topics, concepts, and ideas from the overview.

    RULES:
    - Each note must represent ONE independent idea from the overview.
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

    CHAPTER OVERVIEW:
    ${chapterOverview}
    `;

  try {
    const parsed = await opencode.generateJSON(prompt, "pro");
    if (Array.isArray(parsed)) {
      console.log(`[AI Service] Generated ${parsed.length} atomic notes`);
      return parsed;
    }
    if (parsed && Array.isArray(parsed.notes)) {
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
    const parsed = await opencode.generateJSON(prompt, "pro");
    if (!parsed) {
      throw new Error("Failed to parse book analysis JSON from model response");
    }
    return parsed;
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
    return await opencode.generate(prompt, "flash");
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

    if (folderNames.length === 0) {
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
      const parsed = await opencode.generateJSON(taxonomyPrompt, "pro");
      // Handle potential object wrapper { "folders": [...] } or direct array
      if (Array.isArray(parsed)) {
        folderNames = parsed;
      } else if (parsed && Array.isArray(parsed.folders)) {
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
        const parsed = await opencode.generateJSON(batchPrompt, "pro");
        const assignments = parsed?.assignments || [];

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

/**
 * Answer a natural-language question using retrieved notes as context (RAG).
 * Uses the "flash" model for fast, lightweight responses.
 *
 * @param {string} query - The user's question.
 * @param {Array<{id:string,title:string,content:string,score?:number}>} sources - Retrieved notes.
 * @returns {Promise<string>}
 */
async function answerQuestion(query, sources) {
  const context = sources
    .map(
      (s, i) =>
        `[${i + 1}] Title: ${s.title}\nContent: ${s.content}`,
    )
    .join("\n\n");

  const prompt = `
You are a knowledgeable assistant helping a user understand their personal notes.

TASK:
Answer the user's question using ONLY the notes provided below. Synthesize a clear, direct answer.

RULES:
- Base your answer strictly on the provided notes. Do not invent facts.
- If the notes do not contain enough information to answer, say so honestly.
- Write in a helpful, concise style. Use Markdown (bullet points where useful).
- You may reference which notes you drew from (e.g., "Based on note 1 and 3").

USER QUESTION:
${query}

NOTES:
${context}
  `;

  try {
    return await opencode.generate(prompt, "flash");
  } catch (error) {
    console.error("AI Service Error (Answer Question):", error);
    throw error;
  }
}

module.exports = {
  generateChapterOverview,
  generateAtomicNotes,
  generateOverallAnalysis,
  explainLinkRelationship,
  generateFolderStructure,
  answerQuestion,
};
