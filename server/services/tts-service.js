const AUDIO_DIR = path.join(__dirname, "../uploads/audio");

// Piper Configuration (for Linux/Non-Mac)
const PIPER_DIR = path.join(__dirname, "../piper");
const PIPER_BINARY = path.join(PIPER_DIR, "piper");
const MODEL_PATH = path.join(
  __dirname,
  "../models/piper/en_US-lessac-medium.onnx"
);

// Ensure audio directory exists
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

/**
 * Generates audio from text:
 * - macOS: Uses system 'say' command (No RAM overhead).
 * - Linux/Cloud: Uses local 'Piper' binary (Fast, Neural).
 * Returns the path to the generated WAV file.
 */
async function generateAudio(text) {
  return new Promise((resolve, reject) => {
    // 1. Create a hash of the text to serve as the cache key/filename
    const hash = crypto.createHash("md5").update(text).digest("hex");
    const outputFile = path.join(AUDIO_DIR, `${hash}.wav`);

    // 2. Check Cache
    if (fs.existsSync(outputFile)) {
      console.log(`[TTS] Cache hit for: ${hash}`);
      return resolve(outputFile);
    }

    console.log(`[TTS] Generating audio for: ${hash}`);

    const isMac = process.platform === "darwin";
    let processCmd, processArgs;

    if (isMac) {
      // macOS Native
      processCmd = "say";
      processArgs = ["-o", outputFile, "--data-format=LEI16@22050"];
    } else {
      // Linux / Server (Piper)
      processCmd = PIPER_BINARY;
      processArgs = ["--model", MODEL_PATH, "--output_file", outputFile];
    }

    const ttsProcess = spawn(processCmd, processArgs);

    // Write text to stdin
    ttsProcess.stdin.write(text);
    ttsProcess.stdin.end();

    let stderr = "";

    ttsProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ttsProcess.on("close", (code) => {
      if (code !== 0) {
        console.error(`[TTS] Process failed (${processCmd}): ${stderr}`);
        return reject(
          new Error(`TTS exited with code ${code}. Error: ${stderr}`)
        );
      }
      resolve(outputFile);
    });

    ttsProcess.on("error", (err) => {
      console.error(`[TTS] Spawn error:`, err);
      reject(err);
    });
  });
}

/**
 * Streams the audio file to the response.
 */
function streamAudio(filePath, res) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = res.req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": "audio/wav",
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      "Content-Length": fileSize,
      "Content-Type": "audio/wav",
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
}

module.exports = { generateAudio, streamAudio };
