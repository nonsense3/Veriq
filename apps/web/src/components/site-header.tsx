"use client";

import { ArrowRight, ArrowUpRight, EllipsisVertical, Moon, Sun, UserRound } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { BrandMark } from "./brand-mark";
import { navigateWithTransition } from "./route-transition";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Investigate" },
  { href: "/repository", label: "Repository" },
  { href: "/verify", label: "Verify" },
];

/**
 * Header: wordmark in the page flow, plus a compact fixed control cluster (theme, primary action, profile,
 * menu). The menu opens as a stack of cards rather than a top navigation bar.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const { user, profile } = useAuth();
  const { resolved, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    firstLink.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function submitQuick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = quick.trim();
    if (!value) return;
    setOpen(false);
    navigateWithTransition(`/dashboard?target=${encodeURIComponent(value.slice(0, 2048))}`);
  }

  const card = (index: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: -14, scaleY: 0.9 },
    animate: { opacity: 1, y: 0, scaleY: 1 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: -10, scaleY: 0.94 },
    transition: { duration: reduce ? 0.1 : 0.5, delay: reduce ? 0 : index * 0.06, ease: [0.16, 1, 0.3, 1] as const },
  });

  const name = profile?.display_name || user?.email || "";
  const initial = name ? name.trim()[0]?.toUpperCase() : "";

  return (
    <header className="site-header">
      <div className="container">
        <Link aria-label="Veriq home" href="/">
          <BrandMark />
        </Link>
        <span aria-hidden="true" className="controls-spacer" />
      </div>

      <div className="controls">
        <button aria-label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"} className="round" onClick={toggle} type="button">
          {resolved === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <Link className="pill pill-dark hide-sm" href="/dashboard">
          Investigate <span className="dot" />
        </Link>
        <Link aria-label={user ? "Your profile" : "Sign in"} className={user ? "round profile-chip signed" : "round profile-chip"} href={user ? "/profile" : "/sign-in"}>
          {user && initial ? <span>{initial}</span> : <UserRound size={17} />}
        </Link>
        <button aria-controls="site-menu" aria-expanded={open} className="pill pill-light" onClick={() => setOpen((value) => !value)} ref={trigger} type="button">
          {open ? "Close" : "Menu"} <EllipsisVertical size={15} />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <div aria-hidden="true" className="menu-scrim" onClick={() => setOpen(false)} />
            <nav aria-label="Site menu" className="menu-panel" id="site-menu">
              <motion.div className="menu-card menu-nav" {...card(0)}>
                {NAV.map((item, index) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <Link aria-current={active ? "page" : undefined} href={item.href} key={item.href} ref={index === 0 ? firstLink : undefined}>
                      {item.label} {active && <span className="dot" />}
                    </Link>
                  );
                })}
              </motion.div>
              <motion.div className="menu-card menu-quick" {...card(1)}>
                <h3>Check a link before you open it</h3>
                <form onSubmit={submitQuick}>
                  <label className="sr-only" htmlFor="menu-quick">Link or domain</label>
                  <input autoComplete="off" id="menu-quick" onChange={(event) => setQuick(event.target.value)} placeholder="Paste a link" spellCheck={false} value={quick} />
                  <button aria-label="Investigate" type="submit"><ArrowRight size={18} /></button>
                </form>
              </motion.div>
              <motion.div {...card(2)}>
                <Link className="menu-card menu-dark" href={user ? "/profile" : "/sign-in"}>
                  {user ? "Your profile" : "Sign in"} <ArrowUpRight size={20} />
                </Link>
              </motion.div>
            </nav>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-inner">
          <div className="footer-top">
            <p className="footer-note">Verify before you trust. No scanner can guarantee a site is safe.</p>
            <nav aria-label="Footer">
              <Link href="/dashboard">Investigate</Link>
              <Link href="/repository">Repository</Link>
              <Link href="/verify">Verify</Link>
              <Link href="/profile">Profile</Link>
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/terms">Terms of Service</Link>
            </nav>
          </div>
          <div aria-hidden="true" className="footer-word">Veriq</div>
        </div>
      </div>
    </footer>
  );
}
