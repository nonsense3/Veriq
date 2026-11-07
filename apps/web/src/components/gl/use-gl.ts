"use client";

import { useEffect, useRef, useState } from "react";
import type { WebGLRenderer } from "three";

type Three = typeof import("three");

export type GLScene = {
  frame: (time: number, delta: number) => void;
  resize: (width: number, height: number) => void;
  /** Pointer position relative to the host, 0..1 inside it (can be outside when the pointer leaves). */
  pointer?: (x: number, y: number) => void;
  dispose: () => void;
};

export type GLFactory = (three: Three, renderer: WebGLRenderer, host: HTMLElement) => GLScene | Promise<GLScene>;

/**
 * Rendering budget for this device. Scenes use it to pick particle counts, and useGL uses it for
 * pixel ratio, antialiasing and frame rate. `deviceMemory` is Chromium-only, so a missing value is
 * treated as mid-range rather than low.
 */
export function deviceTier(): "low" | "mid" | "high" {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return "low";
  if (cores <= 4 || memory <= 2) return "low";
  if (cores <= 8 || window.matchMedia("(pointer: coarse)").matches) return "mid";
  return "high";
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Shared WebGL lifecycle: lazy-loads three.js, caps pixel ratio, pauses when off-screen or the tab is hidden,
 * renders a single still frame for reduced-motion users, and reports failure so callers show a CSS fallback.
 */
export function useGL(factory: GLFactory, options: { maxDpr?: number; sceneKey?: string } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;
  const maxDpr = options.maxDpr ?? 1.75;
  const sceneKey = options.sceneKey;

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    setFailed(false);
    let disposed = false;
    let cleanup = () => {};

    const initialize = async () => {
      const THREE = await import("three");
      if (disposed) return;
      const tier = deviceTier();
      let renderer: WebGLRenderer;
      try {
        // Antialiasing and a high pixel ratio are the two costliest settings on weak GPUs, so both
        // scale with the tier. A phone at dpr 3 would otherwise shade nine times the pixels.
        renderer = new THREE.WebGLRenderer({
          antialias: tier === "high",
          alpha: true,
          powerPreference: tier === "low" ? "low-power" : "high-performance",
        });
      } catch {
        setFailed(true);
        return;
      }
      const dprCap = tier === "low" ? 1 : tier === "mid" ? 1.4 : maxDpr;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
      renderer.domElement.setAttribute("aria-hidden", "true");
      host.appendChild(renderer.domElement);
      let scene: GLScene;
      try { scene = await factoryRef.current(THREE, renderer, host); }
      catch (error) { renderer.dispose(); renderer.domElement.remove(); throw error; }
      if (disposed) {
        scene.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        return;
      }

      const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
      let reduce = motionPreference.matches;
      let raf = 0;
      let inView = true;
      let visible = !document.hidden;
      let last = performance.now();
      let elapsed = 0;
      const frameInterval = 1000 / (tier === "low" ? 24 : tier === "mid" ? 30 : 60);

      const still = () => {
        try { scene.frame(elapsed, 1 / 60); }
        catch { setFailed(true); cleanup(); }
      };
      const size = () => {
        const rect = host.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        renderer.setSize(rect.width, rect.height, false);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        scene.resize(rect.width, rect.height);
        still();
      };
      const loop = (now: number) => {
        raf = 0;
        if (!inView || !visible) return;
        if (now - last < frameInterval - 1) { raf = requestAnimationFrame(loop); return; }
        const delta = Math.min((now - last) / 1000, 1 / 20);
        last = now;
        elapsed += delta;
        try { scene.frame(elapsed, delta); }
        catch { setFailed(true); cleanup(); return; }
        raf = requestAnimationFrame(loop);
      };
      const play = () => {
        if (reduce || raf || !inView || !visible) return;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      };

      const resizeObserver = new ResizeObserver(size);
      resizeObserver.observe(host);
      size();
      const intersection = new IntersectionObserver(([entry]) => {
        inView = Boolean(entry?.isIntersecting);
        play();
      });
      intersection.observe(host);
      const pause = () => { cancelAnimationFrame(raf); raf = 0; };
      const onVisibility = () => {
        visible = !document.hidden;
        if (visible) play(); else pause();
      };
      document.addEventListener("visibilitychange", onVisibility);
      const onPointer = (event: PointerEvent) => {
        if (event.pointerType !== "mouse" || tier === "low" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) { scene.pointer?.(-1, -1); return; }
        const rect = host.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        scene.pointer?.((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      };
      const onLeave = () => scene.pointer?.(-1, -1);
      const inputPreference = window.matchMedia("(hover: hover) and (pointer: fine)");
      inputPreference.addEventListener("change", onLeave);
      window.addEventListener("scroll", onLeave, { passive: true });
      host.addEventListener("pointermove", onPointer, { passive: true });
      host.addEventListener("pointerleave", onLeave);
      const onMotionChange = () => { reduce = motionPreference.matches; if (reduce) { pause(); still(); } else play(); };
      motionPreference.addEventListener("change", onMotionChange);
      const onLost = (event: Event) => {
        event.preventDefault();
        pause();
        setFailed(true);
      };
      renderer.domElement.addEventListener("webglcontextlost", onLost);

      if (reduce) still();
      else play();
      host.dataset.ready = "true";

      cleanup = () => {
        cancelAnimationFrame(raf);
        resizeObserver.disconnect();
        intersection.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        host.removeEventListener("pointermove", onPointer);
        host.removeEventListener("pointerleave", onLeave);
        inputPreference.removeEventListener("change", onLeave);
        window.removeEventListener("scroll", onLeave);
        motionPreference.removeEventListener("change", onMotionChange);
        renderer.domElement.removeEventListener("webglcontextlost", onLost);
        scene.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        delete host.dataset.ready;
      };
    };

    // Allocate a GPU context only near the viewport, rather than for every scene on the page.
    let booted = false;
    const startup = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || booted) return;
      booted = true;
      startup.disconnect();
      void initialize().catch(() => { if (!disposed) { cleanup(); setFailed(true); } });
    }, { rootMargin: "150px 0px" });
    startup.observe(host);

    return () => {
      disposed = true;
      startup.disconnect();
      cleanup();
    };
  }, [maxDpr, sceneKey]);

  return { ref, failed };
}

/** sRGB hex → [r, g, b] in 0..1 without colour-management conversion (shaders output these directly). */
export function rgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const number = Number.parseInt(full, 16);
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}
