require("dotenv").config();

// OpenCode server (sidecar via `opencode serve`) client.
// The @opencode-ai/sdk is ESM-only, so we load it lazily via dynamic import
// from within this CommonJS module.

const BASE_URL = process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096";

const PROVIDER_ID = "opencode-go";

function configuredModels() {
  // Prefer validated config; fall back to env/defaults for standalone scripts.
  try {
    const { config } = require("../config");
    return {
      pro: { providerID: PROVIDER_ID, modelID: config.opencodeProModel },
      flash: { providerID: PROVIDER_ID, modelID: config.opencodeFlashModel },
    };
  } catch {
    return {
      pro: {
        providerID: PROVIDER_ID,
        modelID: process.env.OPENCODE_PRO_MODEL || "muse-spark-1.3-contributor",
      },
      flash: {
        providerID: PROVIDER_ID,
        modelID: process.env.OPENCODE_FLASH_MODEL || "muse-spark-1.3-contributor",
      },
    };
  }
}

function modelFor(modelKey) {
  const models = configuredModels();
  return models[modelKey] || models.pro;
}

// Human label recorded in mirrors/logs, e.g. "opencode-go/muse-spark-1.3-contributor".
function modelLabel(modelKey = "pro") {
  const m = modelFor(modelKey);
  return `${m.providerID}/${m.modelID}`;
}

let clientPromise = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createOpencodeClient } = await import("@opencode-ai/sdk");
      return createOpencodeClient({ baseUrl: BASE_URL });
    })();
  }
  return clientPromise;
}

function formatError(context, err) {
  const message = err?.message || String(err);
  console.error(`[OpenCode] ${context}:`, message);
  return new Error(`[OpenCode] ${context}: ${message}`);
}

/**
 * Generate raw text for a prompt using the requested model tier.
 * @param {string} prompt
 * @param {"pro"|"flash"} modelKey
 * @returns {Promise<string>}
 */
async function generate(prompt, modelKey = "pro") {
  const client = await getClient();
  const model = modelFor(modelKey);

  let sessionRes;
  try {
    sessionRes = await client.session.create({
      body: { title: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    });
  } catch (err) {
    throw formatError(
      `connect to OpenCode sidecar at ${BASE_URL} — is \`opencode serve --port 4096 --hostname 127.0.0.1\` running?`,
      err,
    );
  }
  if (sessionRes.error || !sessionRes.data?.id) {
    throw formatError("session.create", sessionRes.error);
  }
  const sessionId = sessionRes.data.id;

  try {
    const result = await client.session.prompt({
      path: { id: sessionId },
      body: {
        model,
        tools: {},
        parts: [{ type: "text", text: prompt }],
      },
    });

    if (result.error) {
      throw formatError("session.prompt", result.error);
    }

    const text = (result.data?.parts || [])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("");

    if (!text.trim()) {
      throw new Error("[OpenCode] Empty response from model");
    }

    return text.trim();
  } finally {
    client.session
      .delete({ path: { id: sessionId } })
      .catch(() => {});
  }
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/```json([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (e2) {
        console.error("Failed to parse extracted JSON", e2);
      }
    }
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      try {
        return JSON.parse(text.substring(first, last + 1));
      } catch (e3) {
        console.error("Failed to parse fuzzy JSON", e3);
      }
    }
    const arrFirst = text.indexOf("[");
    const arrLast = text.lastIndexOf("]");
    if (arrFirst !== -1 && arrLast !== -1 && arrLast > arrFirst) {
      try {
        return JSON.parse(text.substring(arrFirst, arrLast + 1));
      } catch (e4) {
        console.error("Failed to parse fuzzy JSON array", e4);
      }
    }
    return null;
  }
}

/**
 * Generate structured JSON for a prompt using the requested model tier.
 * @returns {Promise<object|null>}
 */
async function generateJSON(prompt, modelKey = "pro") {
  const text = await generate(prompt, modelKey);
  return parseJSON(text);
}

module.exports = {
  generate,
  generateJSON,
  parseJSON,
  modelFor,
  modelLabel,
};
