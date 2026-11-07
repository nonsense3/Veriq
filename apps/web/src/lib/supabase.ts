import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const builtUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Supabase's new publishable key (sb_publishable_…); the legacy anon key is accepted as a fallback.
const builtKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function clientFor(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

/** Live bindings: a deployed page can fill these from the Worker after the static build. */
export let authConfigured = Boolean(builtUrl && builtKey);
export let supabase: SupabaseClient | null = authConfigured ? clientFor(builtUrl!, builtKey!) : null;
export let authPublic: { url: string; key: string } | null = authConfigured ? { url: builtUrl!, key: builtKey! } : null;

const readyWaiters: Array<() => void> = [];

function publishClient(url: string, key: string) {
  supabase = clientFor(url, key);
  authPublic = { url, key };
  authConfigured = true;
  readyWaiters.splice(0).forEach((notify) => notify());
}

/**
 * Uses keys baked in at build time when present. Otherwise asks this site's Worker, which reads
 * the public Supabase values from its own variables. Secret keys are never requested.
 */
export async function loadAuthConfig(): Promise<boolean> {
  if (authConfigured && supabase) return true;
  if (typeof window === "undefined") return false;
  try {
    const response = await fetch("/v1/public-config", { cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json()) as { supabaseUrl?: string; supabaseKey?: string };
    if (!body.supabaseUrl || !body.supabaseKey) return false;
    publishClient(body.supabaseUrl, body.supabaseKey);
    return true;
  } catch {
    return false;
  }
}

export function whenAuthReady(notify: () => void): () => void {
  if (supabase) {
    notify();
    return () => undefined;
  }
  readyWaiters.push(notify);
  return () => {
    const index = readyWaiters.indexOf(notify);
    if (index >= 0) readyWaiters.splice(index, 1);
  };
}

export function siteOrigin(): string {
  return window.location.origin;
}

/** Only same-site relative paths are accepted as post-login destinations (prevents open redirects). */
export function safeNext(value: string | null | undefined, fallback = "/profile"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}

/** Translate Supabase auth errors into clear, non-enumerating messages. */
export function authErrorMessage(error: unknown): { title: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const code = (error as { code?: string } | null)?.code ?? "";
  const text = `${code} ${raw}`.toLowerCase();
  if (text.includes("invalid login") || text.includes("invalid_credentials")) return { title: "Email or password is incorrect", message: "Check both and try again, or reset your password." };
  if (text.includes("email not confirmed") || text.includes("email_not_confirmed")) return { title: "Confirm your email first", message: "Open the confirmation link we sent you, then sign in." };
  if (text.includes("rate limit") || text.includes("over_email_send_rate_limit") || text.includes("too many")) return { title: "Too many attempts", message: "Wait a minute before trying again." };
  if (text.includes("weak") || text.includes("password should")) return { title: "Choose a stronger password", message: "Use at least 8 characters with a mix of letters, numbers and symbols." };
  if (text.includes("already registered") || text.includes("user_already_exists")) return { title: "Use your existing sign-in method", message: "Sign in instead, or reset your password if you have forgotten it." };
  if (text.includes("identity_already_exists") || text.includes("already linked")) return { title: "Already connected elsewhere", message: "That provider account is linked to a different Veriq account." };
  if (text.includes("manual linking") || text.includes("manual_linking_disabled")) return { title: "Connecting providers is turned off", message: "Enable “Allow manual linking” in Supabase → Authentication → Sign In / Providers." };
  if (text.includes("redirect") && text.includes("not allowed")) return { title: "Callback URL not allowed", message: "Add this site's /auth/callback URL to Supabase → Authentication → URL Configuration." };
  if (text.includes("provider is not enabled") || text.includes("unsupported provider")) return { title: "Provider not enabled", message: "This sign-in method is not enabled for this Veriq instance." };
  if (text.includes("failed to fetch") || text.includes("network")) return { title: "Can't reach the sign-in service", message: "Check your connection and try again." };
  if (text.includes("expired") || text.includes("otp_expired")) return { title: "This link has expired", message: "Request a new link and use it within an hour." };
  if (text.includes("same_password") || text.includes("different from the old")) return { title: "Pick a new password", message: "The new password must differ from the current one." };
  return { title: "Something went wrong", message: "The request could not be completed. Try again in a moment." };
}
