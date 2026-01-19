const fs = require("fs");

// Helper to dynamically import pdfjs-dist (since it's ESM only now)
// Helper to dynamically import pdfjs-dist (since it's ESM only now)
async function loadPdfJs() {
  // Polyfill DOMMatrix and other canvas/DOM APIs for Node.js
  try {
    const canvas = require("@napi-rs/canvas");
    global.start = Date.now();
    if (!global.DOMMatrix) global.DOMMatrix = canvas.DOMMatrix;
    if (!global.ImageData) global.ImageData = canvas.ImageData;
    if (!global.Path2D) global.Path2D = canvas.Path2D;
    // Some versions also need the Canvas itself for certain font ops
    if (!global.Canvas) global.Canvas = canvas.Canvas;
  } catch (e) {
    console.warn(
      "Could not load @napi-rs/canvas polyfills. PDF processing might fail.",
      e
    );
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Disable worker for Node.js environment or point to the worker file
  // In Node, we often can run without a separate worker file by mocking or using specific settings
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    // pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
  }
  return pdfjs;
}

async function parsePDF(filePath) {
  const pdfjsLib = await loadPdfJs();
  const dataBuffer = fs.readFileSync(filePath);
  const data = new Uint8Array(dataBuffer);

  const loadingTask = pdfjsLib.getDocument({
    data: data,
    // Use system fonts if possible (optional)
    disableFontFace: true,
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  const metadata = await doc.getMetadata();
  // Helper to resolve destination to page number
  const resolveDest = async (dest) => {
    if (!dest) return null;
    if (typeof dest === "string") {
      dest = await doc.getDestination(dest);
    }
    if (!dest) return null;
    // dest is [Ref, "XYZ", ...]
    const ref = dest[0];
    try {
      const index = await doc.getPageIndex(ref);
      return index + 1; // Return 1-based page number
    } catch (e) {
      return null;
    }
  };

  // Recursive outline processor
  const processItems = async (items) => {
    const processed = [];
    for (const item of items) {
      const pageNum = await resolveDest(item.dest);
      const children = item.items ? await processItems(item.items) : [];
      processed.push({
        title: item.title,
        page: pageNum,
        items: children,
      });
    }
    return processed;
  };

  // Get raw outline first
  const outline = await doc.getOutline();

  const cleanOutline = await processItems(outline || []);

  let fullText = "";
  const pageDetails = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();

    // Simple text extraction for now, but we can enhance this to capture font sizes later
    // We want to resemble the old output format: ###PAGE_START_N### ... text ... ###PAGE_END_N###
    let pageText = "";
    let lastY = null;

    for (const item of textContent.items) {
      // item.transform is [scaleX, skewY, skewX, scaleY, translateX, translateY]
      // item.str is the text

      if (lastY !== null && item.transform[5] !== lastY) {
        pageText += "\n";
      }
      pageText += item.str;
      lastY = item.transform[5];
    }

    fullText += `\n###PAGE_START_${i}###\n${pageText}\n###PAGE_END_${i}###\n`;

    // Store simple stats for later analysis if needed
    pageDetails.push({
      pageIndex: i,
      // You could store average font size here if you implemented the logic
    });
  }

  return {
    text: fullText,
    outline: cleanOutline, // Flattened/Cleaned outline with page numbers
    info: metadata.info,
    pageCount: numPages,
  };
}

module.exports = {
  parsePDF,
};
