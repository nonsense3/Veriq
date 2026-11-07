"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId, type ReactNode } from "react";

type Option<T extends string> = { value: T; label: ReactNode };

/**
 * Tabs / segmented control whose selection pill slides between options (shared layout animation).
 * `variant="tabs"` uses tab semantics; `variant="toggle"` uses pressed buttons.
 */
export function SlidingTabs<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = "tabs",
  className = "tabs",
  style,
}: {
  options: Array<Option<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  variant?: "tabs" | "toggle";
  className?: string;
  style?: React.CSSProperties;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <div aria-label={label} className={`${className} slide-group`} role={variant === "tabs" ? "tablist" : "group"} style={style}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            aria-pressed={variant === "toggle" ? selected : undefined}
            aria-selected={variant === "tabs" ? selected : undefined}
            key={option.value}
            onClick={() => onChange(option.value)}
            role={variant === "tabs" ? "tab" : undefined}
            style={{ color: selected ? "var(--ink)" : undefined }}
            type="button"
          >
            {selected && <motion.span className="slide-pill" layoutId={`pill-${id}`} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
