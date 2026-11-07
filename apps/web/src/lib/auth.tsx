"use client";

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { deviceId, isRevokedForThisDevice, touchDevice } from "./devices";
import { authPublic, loadAuthConfig, supabase } from "./supabase";

export type Profile = { display_name: string | null; avatar_url: string | null; theme: string | null; created_at?: string | null };

type AuthState = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** True when the profiles table is missing (migration not run); profile edits fall back to user metadata. */
  profileTableMissing: boolean;
  /** OAuth providers enabled in this Supabase project (null while loading). */
  providers: string[] | null;
  refreshProfile: () => Promise<void>;
  signOut: (scope?: "local" | "global") => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileTableMissing, setProfileTableMissing] = useState(false);
  const [providers, setProviders] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    void loadAuthConfig().then((ok) => {
      if (!active) return;
      setConfigured(ok);
      const client = supabase;
      if (!ok || !client) {
        setLoading(false);
        return;
      }
      const key = authPublic?.key ?? "";
      const url = (authPublic?.url ?? "").replace(/\/$/, "");
      fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
        .then((response) => (response.ok ? response.json() : null))
        .then((settings: { external?: Record<string, boolean> } | null) => {
          if (!active) return;
          setProviders(Object.entries(settings?.external ?? {}).filter(([name, enabled]) => enabled && name !== "email" && name !== "phone").map(([name]) => name));
        })
        .catch(() => {
          if (active) setProviders([]);
        });
    });
    return () => {
      active = false;
    };
  }, []);

  const loadProfile = useCallback(async (user: User | null) => {
    if (!supabase || !user) {
      setProfile(null);
      return;
    }
    const meta = user.user_metadata as Record<string, unknown>;
    const fallback: Profile = {
      display_name: (meta.display_name ?? meta.full_name ?? meta.name ?? user.email?.split("@")[0] ?? null) as string | null,
      avatar_url: (meta.avatar_url ?? null) as string | null,
      theme: null,
      created_at: user.created_at,
    };
    const { data, error } = await supabase.from("profiles").select("display_name, avatar_url, theme, created_at").eq("id", user.id).maybeSingle();
    if (error) {
      setProfileTableMissing(/relation|does not exist|schema cache|PGRST205/i.test(`${error.code} ${error.message}`));
      setProfile(fallback);
      return;
    }
    setProfileTableMissing(false);
    setProfile(data ? { ...fallback, ...data, display_name: data.display_name ?? fallback.display_name, avatar_url: data.avatar_url ?? fallback.avatar_url } : fallback);
  }, []);

  useEffect(() => {
    if (!configured || !supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
      void loadProfile(data.session?.user ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
      void loadProfile(next?.user ?? null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [configured, loadProfile]);

  // Device sessions: register this browser, and sign it out if it was revoked from another device.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    const client = supabase;
    if (!client || !userId) return;
    let cancelled = false;
    const revoked = async () => {
      try {
        window.sessionStorage.setItem("veriq.signedOutRemotely", "1");
      } catch {
        // storage disabled
      }
      await client.auth.signOut({ scope: "local" });
    };
    void touchDevice(client, userId).then((allowed) => {
      if (!cancelled && !allowed) void revoked();
    });
    const channel = client
      .channel(`device-${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "user_devices", filter: `user_id=eq.${userId}` }, (payload) => {
        const row = payload.new as { device_id?: string; revoked_at?: string | null };
        if (row.device_id === deviceId() && isRevokedForThisDevice(row as { revoked_at: string | null })) void revoked();
      })
      .subscribe();
    const heartbeat = window.setInterval(() => {
      void touchDevice(client, userId).then((allowed) => {
        if (!allowed) void revoked();
      });
    }, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      void client.removeChannel(channel);
    };
  }, [userId]);

  const value = useMemo<AuthState>(
    () => ({
      configured,
      loading,
      session,
      user: session?.user ?? null,
      profile,
      profileTableMissing,
      providers,
      refreshProfile: () => loadProfile(session?.user ?? null),
      signOut: async (scope = "local") => {
        await supabase?.auth.signOut({ scope });
      },
    }),
    [configured, loading, session, profile, profileTableMissing, providers, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
