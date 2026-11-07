"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { scrollToTop } from "./smooth-scroll";
import { deviceTier } from "./gl/use-gl";

const EVENT = "veriq:navigate";

/** Navigate with the motion-blur transition (use instead of router.push for in-app navigation from code). */
export function navigateWithTransition(href: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: href }));
}

const normalise = (url: URL) => `${url.pathname.replace(/\/$/, "") || "/"}${url.search}`;

/**
 * Page transition as pure motion blur: the current page blurs out, the route changes underneath,
 * and the new page sharpens in. No loader, no pattern. Reduced motion navigates instantly.
 */
export function RouteTransition() {
  const router = useRouter();
  const [blurred, setBlurred] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches || deviceTier() === "low";

    const go = (href: string) => {
      const target = new URL(href, window.location.href);
      if (normalise(target) === normalise(new URL(window.location.href))) return;
      if (reduce) {
        router.push(href);
        return;
      }
      if (busy.current) return;
      busy.current = true;
      setBlurred(true);
      window.setTimeout(() => {
        router.push(href);
        const want = normalise(target);
        const started = performance.now();
        const check = () => {
          if (normalise(new URL(window.location.href)) === want || performance.now() - started > 5000) {
            window.setTimeout(() => {
              scrollToTop();
              setBlurred(false);
              busy.current = false;
            }, 120);
          } else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }, 320);
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      go(url.pathname + url.search + url.hash);
    };
    const onNavigate = (event: Event) => go((event as CustomEvent<string>).detail);

    document.addEventListener("click", onClick, true);
    window.addEventListener(EVENT, onNavigate);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(EVENT, onNavigate);
    };
  }, [router]);

  return (
    <AnimatePresence>
      {blurred && (
        <motion.div
          animate={{ backdropFilter: "blur(16px)", opacity: 1 }}
          aria-hidden="true"
          className="route-blur"
          exit={{ backdropFilter: "blur(0px)", opacity: 0 }}
          initial={{ backdropFilter: "blur(0px)", opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.65, 0, 0.35, 1] }}
        />
      )}
    </AnimatePresence>
  );
}
