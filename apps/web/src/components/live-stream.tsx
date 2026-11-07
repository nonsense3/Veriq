"use client";

import { RISK_LABELS, type CorrelationCluster, type RepositoryEntry } from "@veriq/contracts";
import { ArrowUpRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useRepositoryRealtime } from "@/lib/realtime";
import { FlowStream } from "./gl/flow-stream";
import { RiskBadge } from "./risk";

/** Liquid data stream with live numbers from the threat repository (Supabase realtime + 60 s refresh). */
export function LiveStream() {
  const [entries, setEntries] = useState<RepositoryEntry[] | null>(null);
  const [clusters, setClusters] = useState<CorrelationCluster[]>([]);
  const [offline, setOffline] = useState(false);

  const load = useCallback(() => {
    api
      .repository()
      .then((data) => {
        setEntries(data.entries);
        setClusters(data.clusters);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);
  useRepositoryRealtime(load);

  const severe = entries?.filter((entry) => entry.classification === "high_risk" || entry.classification === "confirmed_malicious").length ?? 0;
  const confirmed = entries?.reduce((sum, entry) => sum + entry.statements.filter((item) => item.kind === "validate").length, 0) ?? 0;
  const stats = [
    { label: "Shared reports", value: entries?.length ?? 0 },
    { label: "High risk or worse", value: severe },
    { label: "Linked campaigns", value: clusters.length },
    { label: "Community confirmations", value: confirmed },
  ];

  return (
    <div className="stage stream-stage">
      <FlowStream />
      <div aria-hidden="true" className="stream-shade" />
      <div className="stream-top">
        <h2 id="stream-title">Threats in motion, live.</h2>
        <span className="meta-chip glass-chip">{offline ? "Repository offline" : <><span className="live-dot" /> Live repository</>}</span>
      </div>
      <div className="stream-stats">
        {stats.map((stat) => (
          <div className="glass solid stream-stat" key={stat.label}>
            <AnimatePresence mode="popLayout">
              <motion.strong animate={{ y: 0, opacity: 1 }} initial={{ y: 16, opacity: 0 }} key={stat.value}>{entries ? stat.value : "–"}</motion.strong>
            </AnimatePresence>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
      <div className="stream-feed">
        {(entries ?? []).slice(0, 3).map((entry) => (
          <div className="glass solid stream-item" key={entry.publicId}>
            <RiskBadge classification={entry.classification} label={RISK_LABELS[entry.classification]} />
            <span className="wrap">{entry.indicators[0]?.display ?? (entry.kind === "url" ? "Link" : "Message")}</span>
            <span className="muted-on-dark">{new Date(entry.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
          </div>
        ))}
        {entries && entries.length === 0 && (
          <div className="glass solid stream-item empty-stream">
            <span>No shared reports yet. Investigate something, then choose <strong>Seal &amp; share</strong> on its report to start the stream.</span>
          </div>
        )}
        <Link className="pill pill-light pill-sm" href={entries?.length ? "/repository" : "/dashboard"} style={{ justifySelf: "start" }}>{entries?.length ? "Open repository" : "Start an investigation"} <ArrowUpRight size={13} /></Link>
      </div>
    </div>
  );
}
