import { config } from "./config";

export type AuthUser = { id: string; email: string | null };

const cache = new Map<string, { user: AuthUser | null; expires: number }>();

export function authConfigured(): boolean {
  return Boolean(config.supabase.url && config.supabase.publishableKey);
}

/**
 * Resolve a Supabase access token to a user by asking Supabase Auth (`GET /auth/v1/user`).
 * This works with both legacy HS256 and asymmetric signing keys and honours revoked sessions.
 * Results are cached for 60 s. Invalid or absent tokens resolve to null; investigations stay anonymous.
 */
export async function userFromAuthorization(header: string | undefined): Promise<AuthUser | null> {
  if (!header?.startsWith("Bearer ") || !authConfigured()) return null;
  const token = header.slice(7).trim();
  if (token.length < 20 || token.length > 4096) return null;
  const hit = cache.get(token);
  if (hit && hit.expires > Date.now()) return hit.user;
  let user: AuthUser | null = null;
  try {
    const response = await fetch(`${config.supabase.url!.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: config.supabase.publishableKey! },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const body = (await response.json()) as { id?: string; email?: string };
      if (body.id) user = { id: body.id, email: body.email ?? null };
    }
  } catch {
    user = null;
  }
  cache.set(token, { user, expires: Date.now() + 60_000 });
  if (cache.size > 5000) for (const [key, value] of cache) if (value.expires < Date.now()) cache.delete(key);
  return user;
}

export function bearer(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * Write to Supabase as the signed-in user (their access token + the publishable key), so row-level
 * security decides what is allowed. Failures are logged and never break an investigation.
 */
export async function supabaseAsUser(token: string, path: string, init: { method: string; body?: unknown; prefer?: string }): Promise<boolean> {
  if (!authConfigured()) return false;
  try {
    const response = await fetch(`${config.supabase.url!.replace(/\/$/, "")}/rest/v1/${path}`, {
      method: init.method,
      headers: {
        apikey: config.supabase.publishableKey!,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.prefer ? { prefer: init.prefer } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) console.warn(JSON.stringify({ level: "warn", event: "supabase_write_failed", path: path.split("?")[0], status: response.status, detail: (await response.text()).slice(0, 160) }));
    return response.ok;
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", event: "supabase_unreachable", message: (error as Error).message }));
    return false;
  }
}
