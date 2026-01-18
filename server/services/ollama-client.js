require("dotenv").config();
const { Ollama } = require("ollama");

const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

console.log(`Initializing Ollama Client with host: ${host}`);

const ollama = new Ollama({ host });

module.exports = ollama;
