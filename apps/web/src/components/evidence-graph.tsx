"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

type Tone = "ok" | "warn" | "bad" | "info";
type GraphNode = { id: string; x: number; y: number; label: string; detail: string; tone: Tone; r?: number };

const NODES: GraphNode[] = [
  { id: "url", x: 70, y: 110, label: "paypa1-secure-login.com", detail: "Lookalike of paypal.com: “1” replaces “l”.", tone: "bad", r: 7 },
  { id: "hop", x: 250, y: 50, label: "302 → /verify", detail: "Redirect followed safely; every hop re-checked.", tone: "info" },
  { id: "tls", x: 410, y: 150, label: "TLS 1.3 · valid", detail: "Encrypted, but a valid padlock isn't identity.", tone: "ok" },
  { id: "ct", x: 590, y: 70, label: "CT · logged", detail: "Certificate appears in transparency logs.", tone: "ok" },
  { id: "age", x: 160, y: 215, label: "RDAP · 3 days old", detail: "Registered this week, typical of phishing.", tone: "warn" },
  { id: "form", x: 380, y: 255, label: "form → other domain", detail: "Password form posts to a third-party host.", tone: "bad" },
  { id: "feed", x: 650, y: 215, label: "OpenPhish · listed", detail: "Exact match in a live phishing feed.", tone: "bad" },
  { id: "verdict", x: 820, y: 150, label: "High Risk", detail: "Several significant indicators agree.", tone: "bad", r: 10 },
];
const EDGES: Array<[string, string]> = [["url", "hop"], ["hop", "tls"], ["tls", "ct"], ["url", "age"], ["age", "form"], ["tls", "form"], ["form", "feed"], ["ct", "verdict"], ["feed", "verdict"], ["hop", "ct"]];

const byId = new Map(NODES.map((node) => [node.id, node]));
const curve = (a: GraphNode, b: GraphNode) => {
  const mid = (a.x + b.x) / 2;
  return `M${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`;
};

/**
 * Interactive evidence graph for the hero stage: nodes float, data packets travel along the edges,
 * the graph leans toward the pointer, and hovering a node lights its connections and explains it.
 */
export function EvidenceGraph() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (reduce) return;
    const element = ref.current?.parentElement;
    if (!element) return;
    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      setOffset({ x: ((event.clientX - rect.left) / rect.width - 0.5) * 18, y: ((event.clientY - rect.top) / rect.height - 0.5) * 12 });
    };
    element.addEventListener("pointermove", onMove);
    return () => element.removeEventListener("pointermove", onMove);
  }, [reduce]);

  const linked = new Set<string>();
  if (active) for (const [a, b] of EDGES) if (a === active || b === active) linked.add(`${a}-${b}`);
  const activeNode = active ? byId.get(active) : undefined;

  return (
    <div className="evidence-graph" ref={ref}>
      <svg aria-label="Example evidence graph for a phishing link" role="img" viewBox="0 0 900 360">
        <g style={{ transform: `translate(${offset.x}px, ${offset.y}px)`, transition: "transform 600ms cubic-bezier(.16,1,.3,1)" }}>
          {EDGES.map(([a, b]) => {
            const from = byId.get(a)!;
            const to = byId.get(b)!;
            const id = `edge-${a}-${b}`;
            const lit = linked.has(`${a}-${b}`);
            return (
              <g key={id}>
                <path className={lit ? "g-edge lit" : "g-edge"} d={curve(from, to)} id={id} />
                {!reduce && (
                  <circle className={to.tone === "bad" ? "g-packet bad" : "g-packet"} r="2.6">
                    <animateMotion begin={`${(a.length * 0.37 + b.length * 0.19) % 2}s`} dur={`${2.6 + (a.length % 3) * 0.6}s`} repeatCount="indefinite">
                      <mpath href={`#${id}`} />
                    </animateMotion>
                  </circle>
                )}
              </g>
            );
          })}
          {NODES.map((node, index) => (
            <g
              className={`g-node tone-${node.tone}${active === node.id ? " on" : ""}${active && active !== node.id && !EDGES.some(([a, b]) => (a === active && b === node.id) || (b === active && a === node.id)) ? " dim" : ""}`}
              key={node.id}
              onBlur={() => setActive(null)}
              onFocus={() => setActive(node.id)}
              onPointerEnter={() => setActive(node.id)}
              onPointerLeave={() => setActive(null)}
              style={{ animationDelay: `${index * 0.45}s` }}
              tabIndex={0}
            >
              <circle className="g-halo" cx={node.x} cy={node.y} r={(node.r ?? 6) + 10} />
              <circle className="g-dot" cx={node.x} cy={node.y} r={node.r ?? 6} />
              <text textAnchor={node.x > 700 ? "end" : "start"} x={node.x > 700 ? node.x - 16 : node.x + 14} y={node.y - 12}>{node.label}</text>
            </g>
          ))}
        </g>
      </svg>
      {activeNode && (
        <div className={`graph-tip tone-${activeNode.tone}`} style={{ left: `${(activeNode.x / 900) * 100}%`, top: `${(activeNode.y / 360) * 100}%` }}>
          {activeNode.detail}
        </div>
      )}
    </div>
  );
}
