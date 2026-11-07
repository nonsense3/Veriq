import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = resolve(here, "..");
export const REPO_ROOT = resolve(APP_ROOT, "../..");

// Load `.env` files (repo root first, then the app) without overriding real environment variables.
for (const file of [resolve(REPO_ROOT, ".env"), resolve(APP_ROOT, ".env")]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readDeployment(): { address?: string; chainId?: number } {
  const file = resolve(REPO_ROOT, "packages/registry/deployments/localhost.json");
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { address?: string; chainId?: number };
    return parsed;
  } catch {
    return {};
  }
}

const deployment = readDeployment();

export const config = {
  port: Number(env("SCANNER_PORT") ?? 8788),
  host: env("SCANNER_HOST") ?? "127.0.0.1",
  allowedOrigins: (env("ALLOWED_ORIGINS") ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((origin) => origin.trim()).filter(Boolean),
  dataDir: env("SCANNER_DATA_DIR") ?? resolve(APP_ROOT, ".data"),
  userAgent: "VeriqInspector/0.2 (+passive security assessment; no scripts executed)",
  limits: {
    requestTimeoutMs: Number(env("INSPECT_TIMEOUT_MS") ?? 8000),
    maxBodyBytes: 1_500_000,
    maxRedirects: 8,
  },
  ai: {
    /** `google` = Gemma hosted on the Gemini API; `openai_compatible` = self-hosted Gemma (Ollama, vLLM, LM Studio). */
    provider: (env("AI_PROVIDER") ?? "google") as "google" | "openai_compatible",
    model: env("AI_MODEL") ?? "gemma-4-26b-a4b-it",
    googleKey: env("GOOGLE_AI_API_KEY") ?? env("GEMINI_API_KEY"),
    baseUrl: (env("AI_BASE_URL") ?? "http://127.0.0.1:11434/v1").replace(/\/$/, ""),
    baseUrlKey: env("AI_API_KEY"),
    timeoutMs: Number(env("AI_TIMEOUT_MS") ?? 60_000),
  },
  supabase: {
    url: env("SUPABASE_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: env("SUPABASE_PUBLISHABLE_KEY") ?? env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    /** Server-only secret key (sb_secret_… or legacy service_role). Enables Supabase report storage. Never expose to the browser. */
    secretKey: env("SUPABASE_SECRET_KEY") ?? env("SUPABASE_SERVICE_ROLE_KEY"),
  },
  intel: {
    urlhausKey: env("URLHAUS_AUTH_KEY"),
    safeBrowsingKey: env("GOOGLE_SAFE_BROWSING_API_KEY"),
    openPhishFeed: env("OPENPHISH_FEED_URL") ?? "https://openphish.com/feed.txt",
    disableNetworkIntel: env("VERIQ_OFFLINE") === "1",
  },
  registry: {
    rpcUrl: env("REGISTRY_RPC_URL") ?? "http://127.0.0.1:8545",
    publicRpcUrl: env("REGISTRY_PUBLIC_RPC_URL") ?? env("REGISTRY_RPC_URL") ?? "http://127.0.0.1:8545",
    contractAddress: env("REGISTRY_CONTRACT_ADDRESS") ?? deployment.address,
    privateKey: env("REGISTRY_PRIVATE_KEY"),
  },
};
