"use client";

import type { InvestigationResponse, PublicError } from "@veriq/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiNotice } from "@/components/notice";
import { ReportView } from "@/components/report-view";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { api, ApiError } from "@/lib/api";
import { cachedReport } from "@/lib/history";

function ReportLoader() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const [response, setResponse] = useState<InvestigationResponse | null>(null);
  const [error, setError] = useState<PublicError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    if (!id) {
      setResponse(null);
      setError({ code: "REPORT_NOT_FOUND", title: "No report selected", message: "Open a report from your history or start a new investigation.", retryable: false, correlationId: "client" });
      return;
    }
    const cached = cachedReport(id);
    setResponse(cached);
    api
      .report(id)
      .then(value => { if (active) setResponse(value); })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.error : { code: "UNEXPECTED_ERROR", title: "Report unavailable", message: "The report could not be loaded.", retryable: true, correlationId: "client" });
      });
    return () => { active = false; };
  }, [id, attempt]);

  const actions = <><button className="pill pill-dark pill-sm" onClick={() => setAttempt(value => value + 1)} type="button">Try again</button><Link className="pill pill-ghost pill-sm" href="/dashboard">New investigation</Link></>;
  if (error && !response) {
    return (
      <div className="center-page">
        <div className="error-card">
          <ApiNotice actions={actions} error={error} />
        </div>
      </div>
    );
  }
  if (!response) return <p className="card muted" role="status">Loading report…</p>;
  return <>{error && <div style={{ marginBottom: 12 }}><ApiNotice actions={actions} error={{ ...error, message: `Showing the saved copy. Live updates are unavailable. ${error.message}` }} /></div>}<ReportView initial={response} key={`${response.report.reportId}-${response.registry.status}`} /></>;
}

export default function ReportPage() {
  return (
    <>
      <SiteHeader />
      <main className="page container" id="main-content">
        <Suspense fallback={<p className="card muted">Loading report…</p>}>
          <ReportLoader />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
