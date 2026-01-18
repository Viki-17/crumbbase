const fs = require("fs");
const pdf = require("pdf-parse");

// --- 1. Page-Aware Extraction ---

async function extractTextFromPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);

  // Custom render to inject page markers
  // This allows us to map text back to page numbers easily
  const options = {
    pagerender: function (pageData) {
      let render_options = {
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      };

      return pageData
        .getTextContent(render_options)
        .then(function (textContent) {
          let lastY,
            text = "";
          for (let item of textContent.items) {
            if (lastY == item.transform[5] || !lastY) {
              text += item.str;
            } else {
              text += "\n" + item.str;
            }
            lastY = item.transform[5];
          }
          // Marker format: ###PAGE_START_1###
          return `\n###PAGE_START_${
            pageData.pageIndex + 1
          }###\n${text}\n###PAGE_END_${pageData.pageIndex + 1}###\n`;
        });
    },
  };

  try {
    const data = await pdf(dataBuffer, options);
    return data.text;
  } catch (e) {
    console.error("PDF Read Error:", e);
    // Fallback to default if render fails (unlikely)
    const data = await pdf(dataBuffer);
    return data.text;
  }
}

// --- 2. Table of Contents Detection ---

function parseToC(text) {
  // Look in the first 20 pages max for ToC structure
  // A page is roughly 3k chars? slightly less. 20 pages approx 60k chars.
  const searchLimit = 60000;
  const scanArea = text.substring(0, searchLimit);

  // ToC Line Regex:
  // Matches: "Chapter 1: The Beginning ....... 5" or "1. Introduction 5"
  // Must end with a number.
  // Must be on its own line.
  const tocLineRegex =
    /^(?:Chapter\s+|PART\s+|Module\s+|Unit\s+|\d+\.\s+|[IVX]+\.?\s+)?([^\.]+?)(?:\.{2,}|[\s\t]+)(\d+)$/gim;

  const entries = [];
  let match;

  // Limit global search to the scan area
  while ((match = tocLineRegex.exec(scanArea)) !== null) {
    const title = match[1].trim();
    const page = parseInt(match[2], 10);

    // Basic validation: Page numbers should theoretically be increasing
    // and reasonably close to each other, but let's just collect valid looking ones first.
    if (title.length > 2 && !isNaN(page)) {
      entries.push({ title, page });
    }
  }

  // Filter noise:
  // ToC usually has at least 3 entries
  if (entries.length < 3) return [];

  // Filter out entries where page number decreases significantly (unless it's a sub-section)
  // But mostly we just want the main flow.
  // Let's ensure page numbers are somewhat ascending.
  return entries.sort((a, b) => a.page - b.page);
}

// --- 3. Splitting Strategies ---

function splitByToC(text, toc) {
  console.log(`Splitting by Table of Contents (${toc.length} chapters found)`);
  const chunks = [];

  for (let i = 0; i < toc.length; i++) {
    const currentEntry = toc[i];
    const nextEntry = toc[i + 1];

    const startMarker = `###PAGE_START_${currentEntry.page}###`;
    const startIdx = text.indexOf(startMarker);

    if (startIdx === -1) continue; // Page not found in text (maybe header mismatch)

    let endIdx = -1;
    if (nextEntry) {
      const endMarker = `###PAGE_START_${nextEntry.page}###`;
      endIdx = text.indexOf(endMarker);
    }

    const content =
      endIdx !== -1
        ? text.substring(startIdx, endIdx)
        : text.substring(startIdx); // Last/Only chapter goes to end

    // Clean markers from content
    const cleanContent = content.replace(/###PAGE_(START|END)_\d+###/g, "");

    if (cleanContent.trim().length > 100) {
      chunks.push(cleanContent.trim());
    }
  }

  return chunks.length > 0 ? chunks : null;
}

function splitByEnhancedRegex(text) {
  // Look for major headers on their own lines
  // Case Insensitive
  // Examples: "CHAPTER 1", "PART III", "MODULE 4", "UNIT 2"
  // Also support "Chapter One" style if possible, but keeping it simpler for now with \d+ or Roman
  const headerRegex =
    /(?:\n|^)\s*(CHAPTER|PART|MODULE|UNIT|SECTION)\s+(?:\d+|[IVXLCDM]+|[A-Z]+)(?:\s*[:.]\s*[^\n]+)?(?:\n|$)/gim;

  // We want to verify these are likely headers and not just references in text.
  // A header often has blank lines around it or is all caps.

  const parts = text.split(headerRegex);
  // split captures the delimiter storage if in parens (which it is)
  // format: [preamble, HEADER_TYPE, Content, HEADER_TYPE, Content...]

  // Actually split isn't great here because we lose the full header match if we aren't careful.
  // Let's use matchAll or specific lookahead split

  // Safer Split:
  const splitRegex =
    /(?=(?:\n|^)\s*(?:CHAPTER|PART|MODULE|UNIT|SECTION)\s+(?:\d+|[IVXLCDM]+|[A-Z]+))/i;
  const rawChunks = text.split(splitRegex);

  const chunks = rawChunks
    .map((c) => c.replace(/###PAGE_(START|END)_\d+###/g, "").trim())
    .filter((c) => c.length > 500); // Filter tiny preambles

  if (chunks.length > 2) {
    console.log(`Splitting by Regex (${chunks.length} chunks found)`);
    return chunks;
  }
  return null;
}

function splitByFallback(text) {
  console.log("Splitting by Fallback (Size)");
  const cleanText = text.replace(/###PAGE_(START|END)_\d+###/g, "");
  const chunks = [];
  const chunkSize = 15000;
  const overlap = 500;

  for (let i = 0; i < cleanText.length; i += chunkSize - overlap) {
    chunks.push(cleanText.substring(i, i + chunkSize));
  }
  return chunks;
}

function splitIntoChapters(text) {
  // 1. Try ToC Splitting
  const toc = parseToC(text);
  if (toc.length > 2) {
    const tocChunks = splitByToC(text, toc);
    if (tocChunks) return tocChunks;
  }

  // 2. Try Enhanced Regex Splitting
  const regexChunks = splitByEnhancedRegex(text);
  if (regexChunks) return regexChunks;

  // 3. Fallback
  return splitByFallback(text);
}

module.exports = {
  extractTextFromPDF,
  splitIntoChapters,
};
