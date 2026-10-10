// Validated runtime config — ported from learncache's src/server/config.ts.
// Fails fast with a clear message instead of obscure mongoose/fetch errors.
require("dotenv").config();
const { z } = require("zod");

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is missing. Copy .env.example to .env and fill it in."),
  OPENCODE_SERVER_URL: z.string().default("http://127.0.0.1:4096"),
  // Deprecated: the DB queue (server/services/jobs.js) replaced RabbitMQ.
  // Kept so old .env files still parse; nothing reads it anymore.
  RABBITMQ_URL: z.string().default("amqp://127.0.0.1"),
});

const parsed = envSchema.parse(process.env);

const config = {
  port: parsed.PORT,
  mongoUri: parsed.MONGODB_URI,
  opencodeServerUrl: parsed.OPENCODE_SERVER_URL,
};

module.exports = { config, envSchema };
