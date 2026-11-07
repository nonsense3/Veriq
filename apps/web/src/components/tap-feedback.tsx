"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

const PACKETS = [18, 78, 138, 198, 258, 318];

/**
 * Touch/pen (and mouse-on-touch-device) click acknowledgement.
 * Mirrors the desktop cursor burst: a targeting ring plus a few outbound packets.
 * Independent of the mouse trail, and never a persistent cursor.
 */
export function TapFeedback() {
  const [tap, setTap] = useState<{ id: number; x: number; y: number } | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fineHover = window.matchMedia("(hover: hover) and (pointer: fine)");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      clearTimeout(timeout);
      setTap(null);
    };
    const down = (event: PointerEvent) => {
      if (reduce.matches) return;
      const touchLike = event.pointerType === "touch" || event.pointerType === "pen";
      // Chrome device emulation reports pointerType "mouse" while hover/pointer media still say touch.
      const mouseOnTouchDevice = event.pointerType === "mouse" && !fineHover.matches;
      if (!touchLike && !mouseOnTouchDevice) return;
      clearTimeout(timeout);
      setTap({ id: ++sequence.current, x: event.clientX, y: event.clientY });
      timeout = setTimeout(() => setTap(null), 560);
    };
    const visibility = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointercancel", clear, { passive: true });
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    reduce.addEventListener("change", clear);
    fineHover.addEventListener("change", clear);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointercancel", clear);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
      reduce.removeEventListener("change", clear);
      fineHover.removeEventListener("change", clear);
    };
  }, []);

  if (!tap) return null;
  return (
    <span
      aria-hidden="true"
      className="tap-feedback"
      key={tap.id}
      onAnimationEnd={(event) => {
        if ((event.target as Element).classList.contains("tap-ring")) setTap(null);
      }}
      style={{ left: tap.x, top: tap.y }}
    >
      <i className="tap-ring" />
      {PACKETS.map((angle) => (
        <b key={angle} style={{ "--tap-a": `${angle}deg` } as CSSProperties} />
      ))}
    </span>
  );
}
