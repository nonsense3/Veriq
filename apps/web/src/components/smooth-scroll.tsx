"use client";

import Lenis from "lenis";
import { useEffect } from "react";
import { deviceTier } from "./gl/use-gl";

declare global {
  interface Window {
    __veriqLenis?: Lenis;
  }
}

/** Inertial smooth scrolling (Lenis). Off for reduced motion; touch keeps native momentum scrolling. */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce), (pointer: coarse)").matches || deviceTier() === "low") return;
    const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true, anchors: { offset: -100 } });
    window.__veriqLenis = lenis;
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      delete window.__veriqLenis;
    };
  }, []);
  return null;
}

export function scrollToTop() {
  if (window.__veriqLenis) window.__veriqLenis.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo({ top: 0 });
}
