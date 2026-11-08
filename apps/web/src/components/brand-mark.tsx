"use client";

import { useTheme } from "@/lib/theme";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  
  return (
    <span className="brand" aria-label="Veriq">
      <img 
        alt="" 
        aria-hidden="true"
        className="brand-mark" 
        height={32}
        src={isDark ? "/Icy White VQ Shield Logo.png" : "/Blue VQ Shield Logo.png"}
        width={32}
      />
      {!compact && <span className="brand-name">Veriq</span>}
    </span>
  );
}
