require("dotenv").config();
const { Ollama } = require("ollama");

const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

console.log(`Initializing Ollama Client with host: ${host}`);

// --- KEY FIX: Use undici (native compatible fetch) ---
// node-fetch v2 returns Node streams which fail with "itr.getReader is not a function" in Ollama
// Undici provides standard Web Streams required by the library.
const { fetch, Agent } = require("undici");

const agent = new Agent({
  keepAliveTimeout: 600000,
  connectTimeout: 60000,
  headersTimeout: 600000,
  bodyTimeout: 600000, // 10 min
});

const customFetch = async (url, options) => {
  return fetch(url, {
    ...options,
    dispatcher: agent,
  });
};

const ollama = new Ollama({
  host,
  fetch: customFetch,
});

module.exports = ollama;
