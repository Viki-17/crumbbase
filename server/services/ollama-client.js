require("dotenv").config();
const { Ollama } = require("ollama");

const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

console.log(`Initializing Ollama Client with host: ${host}`);

// --- KEY FIX: Use node-fetch with Custom Agent ---
// We replace the native fetch (undici) with node-fetch + http/https.Agent
// to reliably handle long timeouts and keep-alive connections.
const fetch = require("node-fetch");
const http = require("http");
const https = require("https");

// Detect protocol and use the appropriate agent
const isHttps = host.startsWith("https://");
const AgentClass = isHttps ? https.Agent : http.Agent;

const agent = new AgentClass({
  keepAlive: true,
  timeout: 600000, // Socket timeout (10 min)
});

const customFetch = async (url, options) => {
  // node-fetch supports 'agent' in options
  return fetch(url, {
    ...options,
    agent,
    timeout: 600000, // Request timeout (10 min)
  });
};

const ollama = new Ollama({
  host,
  fetch: customFetch,
});

module.exports = ollama;
