"use client";

import type { Finding, InvestigationResponse, PublicError, PublicationReview, RegistryReceipt, Report } from "@veriq/contracts";
import { ArrowRight, Download, ExternalLink, Fingerprint, Link2, Plus, Printer, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { remember } from "@/lib/history";
import { CyberScene } from "./gl/cyber-scene";
import { ApiNotice, Notice } from "./notice";
import { RiskBadge, SeverityTag } from "./risk";
import { SlidingTabs } from "./sliding-tabs";

const DIMENSION_LABELS: Record<string, string> = {
  phishing: "Phishing",
  tls: "Certificate",
  configuration: "Configuration",
  intelligence: "Intelligence",
  message: "Social engineering",
};
const DIMENSION_STATUS: Record<string, string> = { clear: "Clear", concern: "Concern", critical: "Critical", unavailable: "Unavailable", not_applicable: "N/A" };

function short(value: string | null | undefined, size = 8) {
  if (!value) return "—";
  return value.length > size * 2 + 3 ? `${value.slice(0, size + 2)}…${value.slice(-size)}` : value;
}

/** Share of particles shown as threats in the report's risk visual. */
const THREAT_DENSITY: Record<Report["risk"]["classification"], number> = { low_risk: 0, inconclusive: 0.04, suspicious: 0.1, high_risk: 0.22, confirmed_malicious: 0.35 };

function stripLabel(summary: string, label: string) {
  const text = summary.startsWith(`${label}: `) ? summary.slice(label.length + 2) : summary;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function FindingRow({ finding, aiText, defaultOpen }: { finding: Finding; aiText?: string | undefined; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [evidence, setEvidence] = useState(false);
  const reduce = useReducedMotion();
  const id = `finding-${finding.id}`;
  return (
    <div className="finding" data-open={open}>
      <button aria-controls={id} aria-expanded={open} className="finding-toggle" onClick={() => setOpen((value) => !value)} type="button">
        <SeverityTag severity={finding.severity} />
        <span className="title">{finding.title}</span>
        <Plus aria-hidden="true" size={18} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div animate={{ height: "auto", opacity: 1 }} className="finding-body" exit={{ height: 0, opacity: 0 }} id={id} initial={{ height: 0, opacity: 0 }} transition={{ duration: reduce ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}>
            <div className="finding-inner">
              <p className="desc">{finding.description}</p>
              {aiText && <p className="ai-line"><Sparkles aria-hidden="true" size={15} style={{ marginTop: 2, flexShrink: 0 }} /> {aiText}</p>}
              <p className="todo"><ArrowRight aria-hidden="true" size={15} style={{ marginTop: 3, flexShrink: 0, color: "var(--signal)" }} /> {finding.recommendation}</p>
              <p className="source-line">
                {finding.source.name}
                {finding.authoritative && " · authoritative match"}
                {finding.source.reference && /^https?:\/\//.test(finding.source.reference) && (
                  <> · <a className="text-link" href={finding.source.reference} rel="noreferrer noopener" target="_blank">source <ExternalLink size={11} /></a></>
                )}
                {finding.evidence.length > 0 && (
                  <> · <button className="text-link" onClick={() => setEvidence((value) => !value)} type="button">{evidence ? "Hide evidence" : "Show evidence"}</button></>
                )}
              </p>
              {evidence && (
                <dl className="evidence">
                  {finding.evidence.map((item, index) => (
                    <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value || "—"}</dd></div>
                  ))}
                </dl>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RegistryCard({ response, onUpdate }: { response: InvestigationResponse; onUpdate: (value: InvestigationResponse) => void }) {
  const { user } = useAuth();
  const [publish, setPublish] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PublicError | null>(null);
  const [review, setReview] = useState<PublicationReview | null>(null);
  const registry: RegistryReceipt = response.registry;

  async function register(confirmPublication = false) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.register(response.report.reportId, { publishToRepository: publish, confirmPublication, ...(note.trim() ? { note: note.trim() } : {}) });
      onUpdate(updated);
      remember(updated);
      setReview(null);
      if (updated.registry.status !== "confirmed") {
        const keyProblem = updated.registry.error?.startsWith("REGISTRY_PRIVATE_KEY ");
        setError({ code: updated.registry.status === "unavailable" ? "REGISTRY_UNAVAILABLE" : "REGISTRY_FAILED", title: keyProblem ? "Report sealing unavailable" : updated.registry.status === "unavailable" ? "Registry offline" : "Registration failed", message: keyProblem ? "We couldn’t register this report on-chain. Your report is still available. Please try again later." : "Your report is safe. Try registering again in a moment.", retryable: true, correlationId: "client" });
      }
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught.error : { code: "UNEXPECTED_ERROR", title: "Registration failed", message: "Try again in a moment.", retryable: true, correlationId: "client" };
      if (apiError.code === "PUBLICATION_CONFIRMATION_REQUIRED") setReview(apiError.review ?? { available: false, authentic: false, important: true, reason: apiError.message });
      else setError(apiError);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    try {
      const bundle = await api.bundle(response.report.reportId);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `veriq-report-${response.report.reportId}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.error : { code: "UNEXPECTED_ERROR", title: "Download failed", message: "Try again in a moment.", retryable: true, correlationId: "client" });
    }
  }

  const confirmed = registry.status === "confirmed";
  return (
    <section aria-labelledby="registry-title" className="card" id="registry">
      <div className="card-head">
        <h2 id="registry-title">Report integrity</h2>
        {confirmed ? <span className="d-pill d-clear"><ShieldCheck size={13} /> On-chain</span> : <span className="d-pill d-unavailable">Not registered</span>}
      </div>
      {confirmed ? (
        <dl className="kv">
          <div><dt>Chain</dt><dd>{registry.chainId}</dd></div>
          <div><dt>Transaction</dt><dd className="mono">{short(registry.transactionHash)}</dd></div>
          <div><dt>Block</dt><dd>{registry.blockNumber}</dd></div>
          <div><dt>Repository</dt><dd>{response.publishedToRepository ? "Published" : "Private"}</dd></div>
        </dl>
      ) : (
        <>
          <p className="muted small">Seal a fingerprint of this report on-chain. Evidence stays private.</p>
          <label className="check"><input checked={publish} onChange={(event) => { setPublish(event.target.checked); setReview(null); }} type="checkbox" /> Share to the threat repository</label>
          {publish && !user && <Notice title="Sign in to share" tone="info">The repository only accepts reports from the signed-in account that ran the investigation. <Link href={`/sign-in?next=${encodeURIComponent(`/report?id=${response.report.reportId}`)}`}>Sign in</Link></Notice>}
          {publish && user && (
            <>
              <label className="sr-only" htmlFor="incident-note">Public note</label>
              <textarea className="textarea" id="incident-note" maxLength={280} onChange={(event) => setNote(event.target.value)} placeholder="Optional note, e.g. “Arrived by SMS”. No personal details." style={{ minHeight: 70 }} value={note} />
            </>
          )}
          {review && (
            <Notice
              actions={
                <>
                  <button className="pill pill-dark pill-sm" disabled={busy} onClick={() => void register(true)} type="button">Publish anyway</button>
                  <button className="pill pill-ghost pill-sm" onClick={() => setReview(null)} type="button">Keep private</button>
                </>
              }
              title={review.authentic || review.important ? "The model flagged this" : "Confirm before publishing"}
              tone="warning"
            >
              {review.reason}
            </Notice>
          )}
          <button className="pill pill-signal block" disabled={busy || (publish && !user)} onClick={() => void register(false)} style={{ marginTop: 10 }} type="button">
            <Fingerprint size={15} /> {busy ? "Sealing" : publish ? "Seal & share" : "Seal report"}
          </button>
        </>
      )}
      {error && <div style={{ marginTop: 12 }}><ApiNotice error={error} /></div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <button className="pill pill-ghost pill-sm" onClick={() => void download()} type="button"><Download size={13} /> Bundle</button>
        <Link className="pill pill-ghost pill-sm" href="/verify">Verify</Link>
      </div>
    </section>
  );
}

type Tab = "path" | "certificate" | "page" | "domain" | "checks";

function EvidenceTabs({ report }: { report: Report }) {
  const { url, dns, redirects, page, tls, ct } = report.evidence;
  const tabs: Array<{ id: Tab; label: string }> = [
    ...(redirects?.length ? [{ id: "path" as const, label: "Redirects" }] : []),
    ...(tls ? [{ id: "certificate" as const, label: "Certificate" }] : []),
    ...(page ? [{ id: "page" as const, label: "Page" }] : []),
    ...(dns ? [{ id: "domain" as const, label: "Domain" }] : []),
    { id: "checks", label: "Checks" },
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]!.id);

  return (
    <section aria-labelledby="evidence-title" className="card">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <h2 id="evidence-title">Technical evidence</h2>
        <SlidingTabs label="Evidence sections" onChange={setTab} options={tabs.map((item) => ({ value: item.id, label: item.label }))} value={tab} />
      </div>
      <div className="tab-panel" role="tabpanel">
        {tab === "path" && redirects && (
          <ol className="path">
            {redirects.map((hop, index) => {
              const hostChange = index > 0 && hop.host !== redirects[index - 1]?.host;
              return (
                <li className="hop" key={`${hop.url}-${index}`}>
                  <span className="code">{hop.status ?? "—"}</span>
                  <span className="url">{hop.url}</span>
                  {hop.error ? <span className="sev sev-high">blocked</span> : hostChange ? <span className="tag">new host</span> : <span />}
                </li>
              );
            })}
          </ol>
        )}
        {tab === "certificate" && tls && (
          <div style={{ display: "grid", gap: 14 }}>
            <dl className="kv">
              <div><dt>Trust</dt><dd>{tls.authorized ? "Trusted chain" : (tls.authorizationError ?? "Not trusted")}</dd></div>
              <div><dt>Hostname</dt><dd>{tls.hostnameMatch ? "Matches" : "Does not match"}</dd></div>
              <div><dt>Protocol</dt><dd>{tls.protocol}</dd></div>
              {ct && <div><dt>Transparency</dt><dd>{ct.status === "completed" ? (ct.leafLogged === false ? "Not found in logs" : "Logged") : "Unavailable"}</dd></div>}
            </dl>
            <div className="chain">
              {tls.chain.map((cert) => (
                <div className="cert" key={cert.fingerprintSha256}>
                  <div className="cert-top">
                    <strong className="wrap">{cert.subject.replace(/^.*CN=/, "")}</strong>
                    <span className="tag">{cert.position === 0 ? "leaf" : cert.selfSigned ? "root" : "intermediate"}</span>
                  </div>
                  <span className="mono">{cert.publicKeyAlgorithm.toUpperCase()} {cert.publicKeyBits ?? "?"} · {cert.signatureAlgorithm ?? "unknown"} · until {cert.validTo.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === "page" && page && (
          <div style={{ display: "grid", gap: 14 }}>
            <dl className="kv">
              <div><dt>Title</dt><dd>{page.title ?? "—"}</dd></div>
              <div><dt>Status</dt><dd>{page.status}</dd></div>
              <div><dt>Forms</dt><dd>{page.forms.length ? page.forms.map((form) => `${form.hasPassword ? "password" : form.hasOtpField ? "OTP" : form.hasPaymentField ? "payment" : "form"} → ${form.actionHost ?? "same page"}`).join(", ") : "None"}</dd></div>
              <div><dt>Brands named</dt><dd>{page.brandMentions.join(", ") || "None"}</dd></div>
            </dl>
            <table className="table">
              <thead><tr><th scope="col">Security header</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {["strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy"].map((name) => (
                  <tr key={name}><td>{name}</td><td>{page.headers[name] ? <span className="d-pill d-clear">Set</span> : <span className="d-pill d-unavailable">Missing</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "domain" && dns && (
          <dl className="kv">
            {url && url.unicodeHostname !== url.hostname && <div><dt>Displayed as</dt><dd>{url.unicodeHostname}</dd></div>}
            <div><dt>Registered</dt><dd>{dns.registration?.registeredAt ? `${dns.registration.registeredAt.slice(0, 10)} · ${dns.registration.ageDays} days` : "Unknown"}</dd></div>
            <div><dt>Registrar</dt><dd>{dns.registration?.registrar ?? "Unknown"}</dd></div>
            <div><dt>Addresses</dt><dd className="mono">{dns.addresses.slice(0, 3).join(", ") || "None"}</dd></div>
          </dl>
        )}
        {tab === "checks" && (
          <div style={{ display: "grid", gap: 14 }}>
            <table className="table">
              <thead><tr><th scope="col">Check</th><th scope="col">Result</th></tr></thead>
              <tbody>
                {report.checks.map((check) => (
                  <tr key={check.id}>
                    <td>{check.label}</td>
                    <td><span className={`d-pill ${check.status === "completed" ? "d-clear" : check.status === "skipped" ? "d-not_applicable" : "d-concern"}`}>{check.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details>
              <summary className="text-link small" style={{ cursor: "pointer" }}>Limitations</summary>
              <ul className="actions-list" style={{ marginTop: 8 }}>
                {report.limitations.slice(0, 6).map((item) => <li className="muted" key={item}>{item}</li>)}
              </ul>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}

export function ReportView({ initial }: { initial: InvestigationResponse }) {
  const [response, setResponse] = useState(initial);
  const report: Report = response.report;
  const aiByFinding = new Map(report.ai.explanations.map((item) => [item.findingId, item.text]));
  const threats = report.findings.filter((finding) => finding.category !== "configuration" && finding.severity !== "info");
  const hygiene = report.findings.filter((finding) => finding.category === "configuration" && finding.severity !== "info");
  const { url, intel, message } = report.evidence;
  const summary = report.ai.status === "generated" ? report.ai.summary : stripLabel(report.risk.summary, report.risk.label);
  const coreGaps = report.checks.filter((check) => check.core && check.status !== "completed" && check.status !== "skipped");

  return (
    <>
      <section aria-labelledby="verdict-title" className="verdict">
        <div className="verdict-main">
          <span className="eyebrow">{report.kind === "url" ? "Link investigation" : "Message investigation"}</span>
          <div>
            <h1 id="verdict-title">{report.risk.label}</h1>
            <p className="verdict-subject" style={{ marginTop: 10 }}>{report.subject.display}</p>
          </div>
          <p className="verdict-summary">{summary}</p>
          <div className="meta-chips">
            <span className="meta-chip"><span>Confidence</span> {report.risk.confidence}</span>
            <span className="meta-chip"><span>Checks</span> {report.coverage.completed}/{report.coverage.total}</span>
            <span className="meta-chip"><span>Analysed</span> {new Date(report.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          <div className="verdict-actions">
            <a className="pill pill-dark" href="#registry"><Fingerprint size={15} /> {response.registry.status === "confirmed" ? "On-chain record" : "Seal report"}</a>
            {report.kind === "url" && url && (
              <Link className="pill pill-ghost" href={`/dashboard?target=${encodeURIComponent(url.normalized)}&parent=${report.reportId}`}><RefreshCcw size={14} /> Re-check</Link>
            )}
            <button className="pill pill-ghost" onClick={() => window.print()} type="button"><Printer size={14} /> Print</button>
          </div>
        </div>
        <div aria-hidden="true" className="stage orb-stage">
          <CyberScene mode="static" palette={report.risk.classification} shapes={[report.risk.classification === "low_risk" ? "shield" : report.risk.classification === "inconclusive" ? "globe" : "lock"]} size={0.85} threat={THREAT_DENSITY[report.risk.classification]} />
          <div className="orb-top">
            <span className="eyebrow" style={{ color: "rgba(255,255,255,.75)" }}>Overall risk</span>
            <RiskBadge classification={report.risk.classification} label={report.risk.label} />
          </div>
          <div className="orb-bottom">
            <div>
              <div className="orb-score">{threats.length}</div>
              <p className="orb-caption">{threats.length === 1 ? "threat indicator" : "threat indicators"} found</p>
            </div>
          </div>
        </div>
      </section>

      <div className="dims">
        {Object.entries(report.dimensions).map(([name, dimension]) => (
          <div className="dim" key={name} title={dimension.note}>
            <span>{DIMENSION_LABELS[name] ?? name}</span>
            <span className={`d-pill d-${dimension.status}`}>{DIMENSION_STATUS[dimension.status] ?? dimension.status}</span>
          </div>
        ))}
      </div>

      <div className="report-grid">
        <div className="stack">
          <section aria-labelledby="findings-title" className="card">
            <div className="card-head">
              <h2 id="findings-title">Key findings</h2>
              {report.ai.status === "generated" && <span className="tag"><Sparkles size={11} style={{ marginRight: 4 }} /> AI explained</span>}
            </div>
            {coreGaps.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Notice title="Some checks couldn't run" tone="warning">{coreGaps.map((check) => check.label).join(", ")}. The result may understate risk.</Notice>
              </div>
            )}
            {threats.length === 0 ? (
              <p className="empty">No threat indicators in the checks that ran.</p>
            ) : (
              threats.map((finding, index) => <FindingRow aiText={aiByFinding.get(finding.id)} defaultOpen={index === 0} finding={finding} key={finding.id} />)
            )}
          </section>

          {hygiene.length > 0 && (
            <section aria-labelledby="hygiene-title" className="card">
              <div className="card-head">
                <h2 id="hygiene-title">Site configuration</h2>
                <span className="tag">Not a phishing signal</span>
              </div>
              {hygiene.map((finding) => <FindingRow aiText={aiByFinding.get(finding.id)} defaultOpen={false} finding={finding} key={finding.id} />)}
            </section>
          )}

          {message && (
            <section aria-labelledby="message-title" className="card">
              <div className="card-head"><h2 id="message-title">Extracted from the message</h2></div>
              <div style={{ display: "grid", gap: 6 }}>
                {message.indicators.length === 0 && <p className="empty">No links, contacts or payment IDs found.</p>}
                {message.indicators.map((indicator) => {
                  const link = indicator.type === "url" ? message.links.find((item) => item.display === indicator.display) : undefined;
                  return (
                    <div className="indicator" key={indicator.hash}>
                      <span style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}><span className="tag">{indicator.type.replace("_", " ")}</span> <span className="value">{indicator.display}</span></span>
                      {link?.normalized && <Link className="pill pill-ghost pill-sm" href={`/dashboard?target=${encodeURIComponent(link.normalized)}`}><Link2 size={12} /> Check</Link>}
                    </div>
                  );
                })}
              </div>
              <details style={{ marginTop: 12 }}>
                <summary className="text-link small" style={{ cursor: "pointer" }}>Redacted message</summary>
                <p className="excerpt" data-lenis-prevent style={{ marginTop: 8 }}>{message.redactedExcerpt}</p>
              </details>
            </section>
          )}

          {report.kind === "url" && <EvidenceTabs report={report} />}
        </div>

        <aside className="stack">
          <RegistryCard onUpdate={setResponse} response={response} />

          <section aria-labelledby="actions-title" className="card">
            <div className="card-head"><h2 id="actions-title">What to do</h2></div>
            <ol className="actions-list">
              {report.recommendations.slice(0, 3).map((item, index) => <li key={item}><span className="n">{index + 1}</span> {item}</li>)}
            </ol>
          </section>

          {intel && intel.length > 0 && (
            <section aria-labelledby="intel-title" className="card">
              <div className="card-head"><h2 id="intel-title">Sources checked</h2></div>
              {intel.map((item, index) => (
                <div className="source-row" key={`${item.source}-${index}`} title={item.detail}>
                  <span>{item.source}</span>
                  <span className={`d-pill ${item.status === "listed" ? "d-critical" : item.status === "not_listed" ? "d-clear" : "d-unavailable"}`}>{item.status === "not_listed" ? "Not listed" : item.status === "listed" ? "Listed" : item.status === "disabled" ? "Off" : "Unavailable"}</span>
                </div>
              ))}
            </section>
          )}

          {report.related.length > 0 && (
            <section aria-labelledby="related-title" className="card">
              <div className="card-head">
                <h2 id="related-title">Related incidents</h2>
                <Link className="text-link small" href="/repository">Repository</Link>
              </div>
              {report.related.slice(0, 4).map((item) => (
                <div className="source-row" key={item.publicId}>
                  <span className="small">{item.matches[0]?.method ?? "Shared indicator"}</span>
                  <span className={`d-pill ${item.strength === "strong" ? "d-critical" : item.strength === "moderate" ? "d-concern" : "d-unavailable"}`}>{item.strength}</span>
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
