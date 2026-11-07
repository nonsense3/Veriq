"use client";

import type { PublicError, ServiceConfig } from "@veriq/contracts";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CyberScene } from "@/components/gl/cyber-scene";
import { InvestigationComposer } from "@/components/investigation-composer";
import { ApiNotice, Notice } from "@/components/notice";
import { RiskBadge } from "@/components/risk";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clearHistory, readHistory, type HistoryItem } from "@/lib/history";

export default function DashboardPage() {
  const { user } = useAuth();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [service, setService] = useState<ServiceConfig | null>(null);
  const [serviceError, setServiceError] = useState<PublicError | null>(null);
  const [prefill, setPrefill] = useState("");
  const [parent, setParent] = useState("");

  useEffect(() => {
    setHistory(readHistory());
    const params = new URLSearchParams(window.location.search);
    const target = params.get("target");
    if (target) setPrefill(target.slice(0, 2048));
    const parentId = params.get("parent");
    if (parentId && /^[0-9a-f-]{36}$/i.test(parentId)) setParent(parentId);
    api.config().then(setService).catch((error: unknown) => setServiceError(error instanceof ApiError ? error.error : null));
  }, []);

  const sources = service ? service.intel.filter((source) => source.enabled).length : 0;

  return (
    <>
      <SiteHeader />
      <main className="page container" id="main-content">
        <div className="page-head">
          <div>
            <h1>What looks suspicious?</h1>
            <p>Paste a link, a domain or a message. You get a clear verdict with the evidence behind it.</p>
          </div>
        </div>

        <div className="stage hero-stage investigation-stage">
          <div aria-hidden="true" className="investigation-art"><CyberScene align="center" shapes={["shield", "helix", "nexus"]} /></div>
          <div className="stage-top">
            <span>{user ? `Signed in · saved to your profile` : "Anonymous · saved in this browser"}</span>
            <span>Passive checks only</span>
          </div>
          <div className="investigation-content">
            {parent && <Notice title="Re-check" tone="info">This result will be linked to the earlier report as a revision.</Notice>}
            <InvestigationComposer initialTarget={prefill} parentReportId={parent} />
          </div>
        </div>

        <div className="layout-main" style={{ marginTop: 10 }}>
          <section aria-labelledby="history-title" className="card">
            <div className="card-head">
              <h2 id="history-title">Recent</h2>
              {history.length > 0 && (
                <button className="pill pill-ghost pill-sm" onClick={() => { clearHistory(); setHistory([]); }} type="button"><Trash2 size={13} /> Clear</button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="empty">Nothing yet. Try a sample above.</p>
            ) : (
              <div className="list-rows">
                {history.map((item) => (
                  <Link href={`/report?id=${item.id}`} key={item.id}>
                    <span style={{ minWidth: 0 }}>
                      <span className="title wrap">{item.subject}</span>
                      <br />
                      <span className="muted small">{item.kind === "url" ? "Link" : "Message"} · {new Date(item.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                    </span>
                    <RiskBadge classification={item.classification} label={item.label} />
                  </Link>
                ))}
              </div>
            )}
          </section>

          <aside className="stack">
            {serviceError && <ApiNotice error={serviceError} />}
            {service && (
              <section aria-labelledby="service-title" className="card">
                <div className="card-head"><h2 id="service-title">This instance</h2></div>
                <dl className="kv">
                  <div><dt>AI explanations</dt><dd className={service.ai.enabled ? "status on" : "status off"}>{service.ai.enabled ? "On" : "Off"}</dd></div>
                  <div><dt>Intelligence sources</dt><dd className="status on">{sources} active</dd></div>
                  <div><dt>Report registry</dt><dd className={service.registry.available ? "status on" : "status off"}>{service.registry.available ? "Online" : "Offline"}</dd></div>
                  <div><dt>Accounts</dt><dd className={service.auth.enabled ? "status on" : "status off"}>{service.auth.enabled ? "On" : "Not configured"}</dd></div>
                </dl>
              </section>
            )}
            {!user && service?.auth.enabled && (
              <Notice actions={<Link className="pill pill-dark pill-sm" href="/sign-in?next=/dashboard">Sign in</Link>} title="Keep your investigations" tone="info">Sign in to see them on any device.</Notice>
            )}
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
