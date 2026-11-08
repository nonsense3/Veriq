"use client";

import type { CorrelationCluster, PublicError, RepositoryEntry, RepositoryDetail } from "@veriq/contracts";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CyberScene } from "@/components/gl/cyber-scene";
import { ApiNotice } from "@/components/notice";
import { RiskBadge, SeverityTag } from "@/components/risk";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useRepositoryRealtime } from "@/lib/realtime";
import { RISK_LABELS } from "@veriq/contracts";

function short(value: string | null, size = 6) {
  return value ? `${value.slice(0, size + 2)}…${value.slice(-size)}` : "—";
}

function StatementForm({ entry, onDone }: { entry: RepositoryEntry; onDone: (entry: RepositoryEntry) => void }) {
  const { user } = useAuth();
  const [kind, setKind] = useState<"validate" | "dispute" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PublicError | null>(null);

  async function submit() {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.statement(entry.publicId, { kind, note }));
      setKind(null);
      setNote("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.error : { code: "UNEXPECTED_ERROR", title: "Not recorded", message: "Try again in a moment.", retryable: true, correlationId: "client" });
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <p className="muted small">Sign in to confirm or dispute. <Link href="/sign-in?next=/repository">Sign in</Link></p>;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button aria-pressed={kind === "validate"} className="pill pill-ghost pill-sm" onClick={() => setKind(kind === "validate" ? null : "validate")} type="button"><ThumbsUp size={12} /> Confirm</button>
        <button aria-pressed={kind === "dispute"} className="pill pill-ghost pill-sm" onClick={() => setKind(kind === "dispute" ? null : "dispute")} type="button"><ThumbsDown size={12} /> Dispute</button>
      </div>
      {kind && (
        <div style={{ display: "grid", gap: 8 }}>
          <label className="sr-only" htmlFor={`note-${entry.publicId}`}>Reason</label>
          <textarea className="textarea" id={`note-${entry.publicId}`} maxLength={280} onChange={(event) => setNote(event.target.value)} placeholder={kind === "validate" ? "Why you agree" : "Why you disagree"} style={{ minHeight: 64 }} value={note} />
          <p className="muted small">Public community review · no wallet fee. Your latest review counts once; it does not change the original report or its seal. Do not include personal information.</p>
          <button className="pill pill-dark pill-sm" disabled={busy || note.trim().length < 3} onClick={() => void submit()} style={{ justifySelf: "start" }} type="button">{busy ? "Posting" : "Post review"}</button>
        </div>
      )}
      {error && <ApiNotice error={error} />}
    </div>
  );
}

function IncidentDetails({ entry }: { entry: RepositoryEntry }) {
  const [detail, setDetail] = useState<RepositoryDetail | null>(null);
  const [error, setError] = useState<PublicError | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    void api.incident(entry.publicId).then((value) => { if (active) setDetail(value); }).catch((caught) => {
      if (active) setError(caught instanceof ApiError ? caught.error : { code: "DETAIL_UNAVAILABLE", title: "Details unavailable", message: "Please try again shortly.", retryable: true, correlationId: "client" });
    });
    return () => { active = false; };
  }, [entry.publicId, attempt]);
  return <section aria-label="Incident details" style={{ display: "grid", gap: 16, marginTop: 18, overflowWrap: "anywhere" }}>
    {error && <ApiNotice error={error} actions={<button className="pill pill-ghost pill-sm" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry details</button>} />}
    {!detail && !error && <p role="status">Loading incident details…</p>}
    {detail && <>
      <h3>Findings and configuration weaknesses</h3>
      <p className="muted small">{detail.coverage.completed}/{detail.coverage.total} checks completed. This public view redacts links and contact identifiers; raw evidence and the private verification bundle are not published.</p>
      {detail.findings.length === 0 && <p>No findings in the completed checks. This does not guarantee safety.</p>}
      {detail.findings.map((finding) => <details key={finding.id} className="finding" style={{ padding: "12px 0" }}>
        <summary><SeverityTag severity={finding.severity} /> {finding.title}</summary>
        <div style={{ display: "grid", gap: 8, paddingTop: 12 }}>
          <p>{finding.description}</p><p><strong>Impact:</strong> {finding.impact}</p><p><strong>Recommendation:</strong> {finding.recommendation}</p>
          <p className="muted small">{finding.category} · {finding.source}</p>
        </div>
      </details>)}
      <details><summary>Checks and limitations</summary><ul>{detail.checks.map((check) => <li key={check.id}>{check.label}: {check.status}</li>)}</ul></details>
    </>}
    <h3>Community discussion</h3>
    <p className="muted small">Reviews are opinions, not verified verdicts. One current vote per signed-in account; accounts are not proof of unique people.</p>
    {entry.statements.length === 0 && <p className="muted small">No reviews yet. Add an evidence-based reason below.</p>}
    {entry.statements.map((statement) => <article className="card" style={{ padding: 16 }} key={statement.statementHash}>
      <strong>{statement.kind === "validate" ? "Confirms" : "Disputes"}</strong><span className="muted small"> · {new Date(statement.createdAt).toLocaleDateString()} · {statement.status === "confirmed" ? "Anchored on-chain" : "Community review (off-chain)"}</span>
      <p style={{ marginTop: 8 }}>{statement.note}</p>
      {statement.status === "confirmed" && statement.transactionHash && entry.registry.chainId === 11155111 && <a className="text-link" href={`https://sepolia.etherscan.io/tx/${statement.transactionHash}`} target="_blank" rel="noopener noreferrer">Review transaction</a>}
    </article>)}
  </section>;
}

export default function RepositoryPage() {
  const [entries, setEntries] = useState<RepositoryEntry[] | null>(null);
  const [clusters, setClusters] = useState<CorrelationCluster[]>([]);
  const [error, setError] = useState<PublicError | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .repository()
      .then((data) => {
        setEntries(data.entries);
        setClusters(data.clusters);
      })
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.error : null));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("incident");
    if (selected && /^0x[0-9a-f]{64}$/i.test(selected)) setExpanded(selected.toLowerCase());
  }, []);
  useRepositoryRealtime(load);

  const update = (updated: RepositoryEntry) => setEntries((current) => current?.map((entry) => (entry.publicId === updated.publicId ? { ...updated, clusterId: entry.clusterId } : entry)) ?? null);

  return (
    <>
      <SiteHeader />
      <main className="page container" id="main-content">
        <div className="stage" style={{ minHeight: 360, padding: "clamp(24px, 3vw, 44px)", display: "flex", alignItems: "flex-end" }}>
          <CyberScene align="right" shapes={["nexus", "globe", "torus-knot"]} threat={0.08} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <h1 style={{ fontSize: "clamp(2.6rem, 5.6vw, 5.6rem)" }}>Threat repository</h1>
            <p style={{ marginTop: 12, color: "rgba(255,255,255,.75)", maxWidth: "46ch" }}>Reports people chose to share. Each one is sealed on-chain. Community reviews never overwrite the original.</p>
          </div>
        </div>

        {error && <div style={{ marginTop: 10 }}><ApiNotice actions={<button className="pill pill-ghost pill-sm" onClick={load} type="button">Retry</button>} error={error} /></div>}

        <div className="layout-main" style={{ marginTop: 10 }}>
          <section aria-labelledby="entries-title" className="card">
            <div className="card-head"><h2 id="entries-title">Incidents</h2><span className="muted small">{entries?.length ?? 0} shared</span></div>
            {entries === null && !error && <p className="muted small">Loading…</p>}
            {entries?.length === 0 && <p className="empty">Nothing shared yet. Seal a report and share it to add it here.</p>}
            {entries?.map((entry) => {
              const confirms = entry.statements.filter((item) => item.kind === "validate").length;
              const disputes = entry.statements.filter((item) => item.kind === "dispute").length;
              return (
                <article className="entry" key={entry.publicId}>
                  <div className="entry-head">
                    <RiskBadge classification={entry.classification} label={RISK_LABELS[entry.classification]} />
                    <span className="muted small">{entry.kind === "url" ? "Link" : "Message"} · {new Date(entry.createdAt).toLocaleDateString([], { dateStyle: "medium" })}</span>
                  </div>
                  <p><a className="text-link" href={`/repository?incident=${entry.publicId}`} aria-expanded={expanded === entry.publicId} onClick={(event) => { event.preventDefault(); setExpanded(expanded === entry.publicId ? null : entry.publicId); window.history.replaceState(null, "", `/repository?incident=${entry.publicId}`); }}>{entry.summary} · View details</a></p>
                  {entry.note && <p className="muted small">“{entry.note}”</p>}
                  <div className="ind-chips">{entry.indicators.slice(0, 5).map((indicator) => <span key={`${indicator.type}-${indicator.hash}`}>{indicator.display}</span>)}</div>
                  <p className="source-line">{entry.registry.chainId === 11155111 && entry.registry.transactionHash ? <a className="text-link" href={`https://sepolia.etherscan.io/tx/${entry.registry.transactionHash}`} target="_blank" rel="noopener noreferrer">Receipt {short(entry.registry.transactionHash)}</a> : `tx ${short(entry.registry.transactionHash)}`} · {confirms} confirm · {disputes} dispute{entry.clusterId ? " · part of a campaign" : ""}</p>
                  {expanded === entry.publicId && <IncidentDetails entry={entry} />}
                  <StatementForm entry={entry} onDone={update} />
                </article>
              );
            })}
          </section>
          <aside className="card">
            <div className="card-head"><h2>Campaigns</h2></div>
            {clusters.length === 0 ? (
              <p className="empty">No linked incidents yet.</p>
            ) : (
              clusters.map((cluster) => (
                <div className="cluster" key={cluster.clusterId}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{cluster.members.length} linked reports</strong>
                    <span className={`d-pill ${cluster.strength === "strong" ? "d-critical" : "d-concern"}`}>{cluster.strength}</span>
                  </div>
                  <div className="ind-chips">{cluster.sharedIndicators.slice(0, 4).map((indicator) => <span key={`${indicator.type}-${indicator.display}`}>{indicator.display}</span>)}</div>
                </div>
              ))
            )}
            <p className="muted small" style={{ marginTop: 12 }}>Shared hosting alone never links two incidents.</p>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
