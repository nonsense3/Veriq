"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "veriq.theme";

/** Runs before hydration (inlined in <head>) so the first paint uses the right theme. */
export const THEME_BOOTSTRAP = `(function(){try{var p=localStorage.getItem("${KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;

function resolve(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference) {
  try {
    window.localStorage.setItem(KEY, preference);
  } catch {
    // storage disabled; the choice still applies to this page view
  }
  document.documentElement.dataset.theme = resolve(preference);
  window.dispatchEvent(new CustomEvent("veriq:theme", { detail: preference }));
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const read = () => {
      let stored: ThemePreference = "system";
      try {
        stored = (window.localStorage.getItem(KEY) as ThemePreference | null) ?? "system";
      } catch {
        stored = "system";
      }
      setPreference(stored);
      setResolved(resolve(stored));
    };
    read();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      read();
      let stored: ThemePreference = "system";
      try {
        stored = (window.localStorage.getItem(KEY) as ThemePreference | null) ?? "system";
      } catch {
        stored = "system";
      }
      if (stored === "system") document.documentElement.dataset.theme = resolve("system");
    };
    media.addEventListener("change", onSystem);
    window.addEventListener("veriq:theme", read);
    return () => {
      media.removeEventListener("change", onSystem);
      window.removeEventListener("veriq:theme", read);
    };
  }, []);

  const set = useCallback((value: ThemePreference) => applyTheme(value), []);
  const toggle = useCallback(() => applyTheme(resolved === "dark" ? "light" : "dark"), [resolved]);
  return { preference, resolved, set, toggle };
}
