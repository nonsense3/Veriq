"use client";

import { useEffect, useRef } from "react";
import { deviceTier } from "./gl/use-gl";
import { TapFeedback } from "./tap-feedback";

const HEX = "0123456789ABCDEF";

/**
 * Cursor overlay: a targeting ring with crosshair ticks that trails the pointer, a fading signal trace, and
 * short hex "packets" shed along fast movement. The native cursor stays visible. Disabled for touch and for
 * reduced motion. The canvas idles (no animation frames) once the trace has faded.
 */
export function CyberCursor() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = window.matchMedia("(any-pointer: coarse)");
    const enabled = () => finePointer.matches && !reducedMotion.matches && deviceTier() !== "low";
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let width = 0;
    let height = 0;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const trail: Array<{ x: number; y: number; t: number }> = [];
    const packets: Array<{ x: number; y: number; vx: number; vy: number; life: number; text: string }> = [];
    let mx = -100, my = -100, rx = -100, ry = -100;
    let ring = 14, ringTarget = 14, spin = 0;
    let visible = false;
    let raf = 0;
    let last = performance.now();
    let emitX = 0, emitY = 0;
    canvas.hidden = true;
    const clear = () => {
      if (canvas.hidden && !raf && !visible && !trail.length && !packets.length) return;
      cancelAnimationFrame(raf);
      raf = 0;
      visible = false;
      trail.length = 0;
      packets.length = 0;
      mx = rx = my = ry = -100;
      ring = ringTarget = 14;
      ctx.clearRect(0, 0, width, height);
      canvas.hidden = true;
    };

    const emit = (x: number, y: number, burst = 1) => {
      for (let i = 0; i < burst && packets.length < 48; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 14 + Math.random() * 30;
        packets.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 8, life: 0.8, text: HEX[Math.floor(Math.random() * 16)]! + HEX[Math.floor(Math.random() * 16)]! });
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (!enabled() || document.hidden) { clear(); return; }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, width, height);
      while (trail.length && now - trail[0]!.t > 420) trail.shift();

      ctx.lineCap = "round";
      for (let i = 1; i < trail.length; i += 1) {
        const a = trail[i - 1]!;
        const b = trail[i]!;
        const fade = 1 - (now - b.t) / 420;
        ctx.strokeStyle = `rgba(74, 104, 255, ${fade * 0.8})`;
        ctx.lineWidth = fade * 2.2 + 0.3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (i % 5 === 0) {
          ctx.fillStyle = `rgba(160, 178, 255, ${fade})`;
          ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);
        }
      }

      ctx.font = "500 10px 'JetBrains Mono', monospace";
      for (let i = packets.length - 1; i >= 0; i -= 1) {
        const packet = packets[i]!;
        packet.life -= dt;
        if (packet.life <= 0) {
          packets.splice(i, 1);
          continue;
        }
        packet.x += packet.vx * dt;
        packet.y += packet.vy * dt;
        ctx.fillStyle = `rgba(74, 104, 255, ${packet.life * 0.9})`;
        ctx.fillText(packet.text, packet.x, packet.y);
      }

      const follow = Math.min(1, dt * 14);
      rx += (mx - rx) * follow;
      ry += (my - ry) * follow;
      ring += (ringTarget - ring) * Math.min(1, dt * 10);
      spin += dt * (ringTarget > 14 ? 2.4 : 0.8);
      if (visible) {
        ctx.strokeStyle = "rgba(74, 104, 255, 0.95)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(rx, ry, ring, spin, spin + Math.PI * 1.55);
        ctx.stroke();
        for (let k = 0; k < 4; k += 1) {
          const angle = spin * 0.5 + (k * Math.PI) / 2;
          const inner = ring + 3;
          const outer = ring + 8;
          ctx.beginPath();
          ctx.moveTo(rx + Math.cos(angle) * inner, ry + Math.sin(angle) * inner);
          ctx.lineTo(rx + Math.cos(angle) * outer, ry + Math.sin(angle) * outer);
          ctx.stroke();
        }
      }

      const moving = Math.abs(mx - rx) + Math.abs(my - ry) > 0.4 || Math.abs(ring - ringTarget) > 0.2;
      if (trail.length || packets.length || moving || (visible && ringTarget > 14)) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      if (!enabled()) { clear(); return; }
      canvas.hidden = false;
      mx = event.clientX;
      my = event.clientY;
      if (!visible) {
        rx = mx;
        ry = my;
        emitX = mx;
        emitY = my;
      }
      visible = true;
      trail.push({ x: mx, y: my, t: performance.now() });
      if (Math.hypot(mx - emitX, my - emitY) > 46) {
        emit(mx, my);
        emitX = mx;
        emitY = my;
      }
      const target = event.target as Element | null;
      ringTarget = target?.closest?.("a, button, input, textarea, select, label, [role='tab']") ? 24 : 14;
      start();
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      if (!enabled()) { clear(); return; }
      onMove(event);
      ring = 7;
      emit(mx, my, 6);
      start();
    };
    const onLeave = () => clear();
    const onResize = () => { clear(); resize(); };
    const onVisibility = () => { if (document.hidden) clear(); };

    window.addEventListener("resize", onResize);
    window.addEventListener("blur", clear);
    window.addEventListener("scroll", clear, { passive: true });
    finePointer.addEventListener("change", clear);
    coarsePointer.addEventListener("change", clear);
    reducedMotion.addEventListener("change", clear);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    canvas.dataset.cursorReady = "true";
    return () => {
      clear();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", clear);
      window.removeEventListener("scroll", clear);
      finePointer.removeEventListener("change", clear);
      coarsePointer.removeEventListener("change", clear);
      reducedMotion.removeEventListener("change", clear);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      delete canvas.dataset.cursorReady;
    };
  }, []);

  return <><canvas aria-hidden="true" className="cyber-cursor" hidden ref={ref} /><TapFeedback /></>;
}
