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

  useEffect(() => {
    if (!id) {
      setError({ code: "REPORT_NOT_FOUND", title: "No report selected", message: "Open a report from your history or start a new investigation.", retryable: false, correlationId: "client" });
      return;
    }
    const cached = cachedReport(id);
    if (cached) setResponse(cached);
    api
      .report(id)
      .then(setResponse)
      .catch((caught: unknown) => {
        if (!cached) setError(caught instanceof ApiError ? caught.error : { code: "UNEXPECTED_ERROR", title: "Report unavailable", message: "The report could not be loaded.", retryable: true, correlationId: "client" });
      });
  }, [id]);

  if (error) {
    return (
      <div className="center-page">
        <div className="error-card">
          <ApiNotice actions={<Link className="pill pill-dark pill-sm" href="/dashboard">New investigation</Link>} error={error} />
        </div>
      </div>
    );
  }
  if (!response) return <p className="card muted" role="status">Loading report…</p>;
  return <ReportView initial={response} key={`${response.report.reportId}-${response.registry.status}`} />;
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
