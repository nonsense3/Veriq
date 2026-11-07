"use client";

import { useEffect } from "react";
import { supabase, whenAuthReady } from "./supabase";

/**
 * Re-run `onChange` whenever the public repository tables change in Supabase (new share, new
 * confirm/dispute). Bursts are coalesced. Returns nothing; no-op when Supabase isn't configured.
 */
export function useRepositoryRealtime(onChange: () => void) {
  useEffect(() => {
    let cleanup: () => void = () => {};
    const stop = whenAuthReady(() => {
      const client = supabase;
      if (!client) return;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onChange, 400);
    };
    const channel = client
      .channel(`repository-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "repository_entries" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "repository_statements" }, schedule)
      .subscribe();
      cleanup = () => {
        window.clearTimeout(timer);
        void client.removeChannel(channel);
      };
    });
    return () => {
      stop();
      cleanup();
    };
  }, [onChange]);
}
