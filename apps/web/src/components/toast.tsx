"use client";

import { CircleCheck, Info, OctagonX, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Tone } from "./notice";

type Toast = { id: number; tone: Tone; title: string; message?: string | undefined };
type ToastApi = { show: (toast: Omit<Toast, "id">) => void };

const ToastContext = createContext<ToastApi | null>(null);
const ICONS = { error: OctagonX, warning: TriangleAlert, info: Info, success: CircleCheck } as const;

/**
 * Floating notifications that drop in from the top, for outcomes that matter beyond one control
 * (session ended, account deletion failed). Errors stay until dismissed; others clear after 5 s.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const reduce = useReducedMotion();

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const show = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = next.current++;
      setToasts((list) => [...list.slice(-2), { ...toast, id }]);
      if (toast.tone !== "error") window.setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="toast-region">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = ICONS[toast.tone];
            return (
              <motion.div
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={`toast tone-${toast.tone}`}
                exit={{ opacity: 0, y: reduce ? 0 : -24, scale: 0.96 }}
                initial={{ opacity: 0, y: reduce ? 0 : -40, scale: 0.96 }}
                key={toast.id}
                layout
                role={toast.tone === "error" ? "alert" : "status"}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              >
                <span className="n-icon" aria-hidden="true"><Icon size={15} strokeWidth={2.2} /></span>
                <span className="toast-text"><strong>{toast.title}</strong>{toast.message && <span>{toast.message}</span>}</span>
                <button aria-label="Dismiss" className="toast-close" onClick={() => dismiss(toast.id)} type="button"><X size={14} /></button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}

/** Small message that slides open right next to the control it belongs to. */
export function InlineStatus({ tone, children }: { tone: Tone; children?: ReactNode }) {
  const Icon = ICONS[tone];
  return (
    <AnimatePresence initial={false}>
      {children && (
        <motion.p
          animate={{ height: "auto", opacity: 1 }}
          className={`inline-status is-${tone}`}
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          role={tone === "error" ? "alert" : "status"}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <span><Icon aria-hidden="true" size={13} /> {children}</span>
        </motion.p>
      )}
    </AnimatePresence>
  );
}
