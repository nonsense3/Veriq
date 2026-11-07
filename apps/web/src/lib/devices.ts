import type { SupabaseClient } from "@supabase/supabase-js";

export type Device = {
  id: string;
  device_id: string;
  label: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

const DEVICE_KEY = "veriq.device.id";
const SIGNED_IN_KEY = "veriq.device.signedInAt";

export function deviceId(): string {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "ephemeral-device";
  }
}

export function deviceLabel(ua = navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "device";
  return `${browser} on ${os}`;
}

/** Call right after a fresh sign-in on this device (password, magic link, OAuth callback). */
export function markFreshSignIn() {
  try {
    window.localStorage.setItem(SIGNED_IN_KEY, new Date().toISOString());
  } catch {
    // storage disabled
  }
}

function signedInAt(): number {
  try {
    return Date.parse(window.localStorage.getItem(SIGNED_IN_KEY) ?? "") || 0;
  } catch {
    return 0;
  }
}

/** True when this device's row was revoked after this device last signed in. */
export function isRevokedForThisDevice(row: Pick<Device, "revoked_at"> | null | undefined): boolean {
  if (!row?.revoked_at) return false;
  return Date.parse(row.revoked_at) > signedInAt();
}

/**
 * Register or refresh this device. A fresh sign-in clears an old revocation; otherwise a revoked row
 * means this device was signed out remotely. Returns false when the device must sign out.
 * Missing table (migration not run) is treated as "allowed" so sign-in keeps working.
 */
export async function touchDevice(client: SupabaseClient, userId: string): Promise<boolean> {
  const id = deviceId();
  const { data, error } = await client.from("user_devices").select("id, revoked_at").eq("device_id", id).maybeSingle();
  if (error) return true;
  if (data && isRevokedForThisDevice(data)) return false;
  const now = new Date().toISOString();
  await client
    .from("user_devices")
    .upsert({ user_id: userId, device_id: id, label: deviceLabel(), user_agent: navigator.userAgent.slice(0, 300), last_seen_at: now, revoked_at: null }, { onConflict: "user_id,device_id" });
  return true;
}
