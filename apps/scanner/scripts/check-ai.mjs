// Quick connectivity check for the configured explanation model. Prints status only, never the key.
// Usage: node apps/scanner/scripts/check-ai.mjs
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const provider = process.env.AI_PROVIDER || "google";
const model = process.env.AI_MODEL || "gemma-4-26b-a4b-it";
const started = Date.now();
try {
  let response;
  if (provider === "openai_compatible") {
    const base = (process.env.AI_BASE_URL || "http://127.0.0.1:11434/v1").replace(/\/$/, "");
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.AI_API_KEY ? { authorization: `Bearer ${process.env.AI_API_KEY}` } : {}) },
      body: JSON.stringify({ model, max_tokens: 32, messages: [{ role: "user", content: 'Reply with {"ok":true}' }] }),
      signal: AbortSignal.timeout(40_000),
    });
  } else {
    if (!process.env.GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY is empty");
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GOOGLE_AI_API_KEY },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: 'Reply with {"ok":true}' }] }], generationConfig: { maxOutputTokens: 64, thinkingConfig: { thinkingLevel: "minimal" } } }),
      signal: AbortSignal.timeout(40_000),
    });
  }
  const body = await response.text();
  console.log(`${provider} ${model}: HTTP ${response.status} in ${Date.now() - started} ms`);
  console.log(body.slice(0, 300));
  process.exitCode = response.ok ? 0 : 1;
} catch (error) {
  console.log(`${provider} ${model}: ${error.name} ${error.message} after ${Date.now() - started} ms`);
  process.exitCode = 1;
}
