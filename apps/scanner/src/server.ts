import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { aiEnabled } from "./ai/explain";
import { authConfigured } from "./auth";
import { config } from "./config";
import { warmIntel } from "./intel/providers";
import { registryState } from "./registry";

const app = createApp();
warmIntel();

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, async (info) => {
  console.log(`Veriq scanner listening on http://${info.address}:${info.port}`);
  console.log(`AI explanations: ${aiEnabled() ? `enabled (${config.ai.provider}, ${config.ai.model})` : "disabled (set GOOGLE_AI_API_KEY or AI_PROVIDER=openai_compatible)"}`);
  console.log(`Accounts: ${authConfigured() ? "Supabase configured" : "disabled (set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"}`);
  console.log(`Storage: ${config.supabase.url && config.supabase.secretKey ? "Supabase (reports + public repository)" : "local file apps/scanner/.data (set SUPABASE_SECRET_KEY to store in Supabase)"}`);
  const state = await registryState();
  console.log("error" in state ? `Registry: ${state.error}` : `Registry: chain ${state.chainId}, contract ${state.address}`);
});
