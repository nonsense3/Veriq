/**
 * Required evaluation scenarios (three suspicious, three benign). Expected and observed results are recorded
 * in docs/testing-report.md. All inputs are controlled fixtures; no live website is contacted.
 */
import { describe, expect, it } from "vitest";
import { assessMessage, assessUrl, EMUDHRA_COMPROMISED_KEYS, normalizeTarget } from "../packages/analysis/src/index";
import { NOT_LISTED, cert, page, tls, urlChecks } from "./fixtures/evidence";

const ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-11-07T08:00:00.000Z";

function urlEvidence(value: string) {
  const result = normalizeTarget(value);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe("S1 · impersonation page with a valid certificate", () => {
  const url = urlEvidence("https://sbi-netbanking-secure.com/login");
  const report = assessUrl({
    reportId: ID, createdAt: NOW,
    collection: {
      url,
      dns: { addresses: ["203.0.113.10"], mx: [], ns: ["ns1.example-dns.test"], cname: [], registration: { source: "RDAP", registeredAt: "2026-11-04T00:00:00Z", ageDays: 3, registrar: "Example Registrar" } },
      redirects: [{ url: url.normalized, status: 200, host: url.hostname, address: "203.0.113.10", location: null, error: null }],
      page: page(url.normalized, {
        title: "State Bank of India - Internet Banking Login",
        textExcerpt: "State Bank of India. Login to OnlineSBI. Username Password. Enter OTP.",
        forms: [{ action: "https://collector.example.net/submit.php", actionHost: "collector.example.net", method: "post", hasPassword: true, hasPaymentField: false, hasOtpField: true }],
        brandMentions: ["State Bank of India"],
      }),
      tls: tls(url.hostname),
      intel: NOT_LISTED,
      checks: urlChecks(),
    },
  });

  it("is High Risk even though TLS is valid", () => {
    expect(report.risk.classification).toBe("high_risk");
    expect(report.dimensions.tls?.status).toBe("clear");
    expect(report.dimensions.phishing?.status).toBe("critical");
  });
  it("explains impersonation, credential exfiltration and domain age with evidence", () => {
    const ids = report.findings.map((finding) => finding.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["page.brand_identity_mismatch", "page.cross_origin_credential_form", "domain.newly_registered", "url.brand_exact_token"]));
    expect(report.findings.every((finding) => finding.source.name.length > 0)).toBe(true);
    expect(report.limitations.some((line) => /valid TLS certificate/.test(line))).toBe(true);
  });
});

describe("S2 · redirect chain to an indicator listed in a malicious dataset", () => {
  const url = urlEvidence("https://bit.ly/3xParcel");
  const destination = "https://parcel-redelivery-fee.top/pay";
  const report = assessUrl({
    reportId: ID, createdAt: NOW,
    collection: {
      url,
      redirects: [
        { url: url.normalized, status: 301, host: "bit.ly", address: "203.0.113.20", location: "https://tracking-hop.example.org/r", error: null },
        { url: "https://tracking-hop.example.org/r", status: 302, host: "tracking-hop.example.org", address: "203.0.113.21", location: destination, error: null },
        { url: destination, status: 200, host: "parcel-redelivery-fee.top", address: "203.0.113.22", location: null, error: null },
      ],
      page: page(destination, { title: "Parcel on hold" }),
      tls: tls("parcel-redelivery-fee.top"),
      intel: [{ source: "OpenPhish community feed", status: "listed", matchScope: "exact URL", detail: "This exact URL is listed as an active phishing URL (fixture dataset).", checkedAt: NOW, reference: "https://openphish.com/" }],
      checks: urlChecks(),
    },
  });

  it("is Confirmed Malicious through an exact, authoritative intelligence match", () => {
    expect(report.risk.classification).toBe("confirmed_malicious");
    const listed = report.findings.find((finding) => finding.ruleId === "intel.listed_exact");
    expect(listed?.authoritative).toBe(true);
    expect(listed?.source.name).toBe("OpenPhish community feed");
  });
  it("records the destination and the shortener redirect", () => {
    const ids = report.findings.map((finding) => finding.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["redirect.cross_domain", "url.shortener"]));
  });
});

describe("S3 · synthetic fraudulent recruitment message", () => {
  const report = assessMessage({
    reportId: ID, createdAt: NOW,
    text: "Congratulations! You are selected for a part-time job with Amazon. Earn Rs 5000 per day from home, no experience required. Pay a refundable registration fee of Rs 999 to UPI hr.desk22@ybl today to receive your offer letter. Details: amazon-jobs-hiring.online/apply",
  });

  it("is High Risk with extracted payment and link indicators", () => {
    expect(report.risk.classification).toBe("high_risk");
    const types = report.evidence.message?.indicators.map((indicator) => indicator.type) ?? [];
    expect(types).toEqual(expect.arrayContaining(["upi", "url", "amount"]));
  });
  it("identifies the job-fee pattern and the brand/link mismatch", () => {
    const ids = report.findings.map((finding) => finding.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["message.job_fee", "message.brand_link_mismatch"]));
    expect(report.evidence.message?.redactedExcerpt).not.toContain("hr.desk22@ybl");
  });
});

describe("B1 · legitimate HTTPS page", () => {
  const url = urlEvidence("https://docs.example-university.edu/admissions");
  const report = assessUrl({
    reportId: ID, createdAt: NOW,
    collection: {
      url,
      dns: { addresses: ["203.0.113.30"], mx: ["mx.example-university.edu"], ns: ["ns1.example-university.edu"], cname: [], registration: { source: "RDAP", registeredAt: "1998-03-01T00:00:00Z", ageDays: 10_478, registrar: "EDUCAUSE" } },
      redirects: [{ url: url.normalized, status: 200, host: url.hostname, address: "203.0.113.30", location: null, error: null }],
      page: page(url.normalized, { title: "Admissions | Example University" }),
      tls: tls(url.hostname),
      ct: { source: "crt.sh", status: "completed", detail: "fixture", totalCertificates: 12, issuedLast30Days: 1, issuers: ["Let's Encrypt"], leafLogged: true },
      intel: NOT_LISTED,
      checks: urlChecks(),
    },
  });

  it("is Low Risk with high coverage and no guarantee wording", () => {
    expect(report.risk.classification).toBe("low_risk");
    expect(report.findings.filter((finding) => finding.severity !== "info")).toEqual([]);
    expect(report.risk.summary).toMatch(/not a guarantee/i);
    expect(report.risk.confidence).toBe("high");
  });

  it("becomes Inconclusive, not Low Risk, when core checks are unavailable", () => {
    const degraded = assessUrl({ reportId: ID, createdAt: NOW, collection: { url, checks: urlChecks({ http: "failed", intel: "unavailable" }) } });
    expect(degraded.risk.classification).toBe("inconclusive");
  });
});

describe("B2 · benign urgent notification", () => {
  const report = assessMessage({
    reportId: ID, createdAt: NOW,
    text: "Reminder: your electricity bill is due tomorrow. Pay before the due date to avoid a late fee. Act now to avoid disconnection charges? No: just pay in the official app or at the service centre. Never share your OTP or PIN with anyone.",
  });

  it("is Low Risk: urgency alone is not fraud", () => {
    expect(report.risk.classification).toBe("low_risk");
    expect(report.findings.some((finding) => finding.ruleId === "message.urgency")).toBe(true);
    expect(report.findings.some((finding) => finding.ruleId === "message.credential_request")).toBe(false);
    expect(report.evidence.message?.protectiveLanguage.length).toBeGreaterThan(0);
  });
});

describe("B3 · benign site with missing headers and an ordinary TLS issue", () => {
  const url = urlEvidence("https://small-bakery-shop.example.com/");
  const report = assessUrl({
    reportId: ID, createdAt: NOW,
    collection: {
      url,
      dns: { addresses: ["203.0.113.40"], mx: [], ns: [], cname: [], registration: { source: "RDAP", registeredAt: "2015-05-01T00:00:00Z", ageDays: 4_208, registrar: "Example" } },
      redirects: [{ url: url.normalized, status: 200, host: url.hostname, address: "203.0.113.40", location: null, error: null }],
      page: page(url.normalized, { headers: { server: "nginx" }, title: "Fresh bread daily" }),
      tls: tls(url.hostname, { chain: [cert({ subject: `CN=${url.hostname}`, subjectAltNames: [url.hostname], daysRemaining: 6 })] }),
      intel: NOT_LISTED,
      checks: urlChecks(),
    },
  });

  it("reports configuration issues separately and stays Low Risk", () => {
    expect(report.risk.classification).toBe("low_risk");
    const config = report.findings.filter((finding) => finding.category === "configuration");
    expect(config.map((finding) => finding.ruleId)).toEqual(expect.arrayContaining(["config.missing_hsts", "config.missing_csp", "tls.expiring_soon"]));
    expect(report.dimensions.configuration?.status).toBe("concern");
    expect(report.dimensions.phishing?.status).toBe("clear");
  });
});

describe("Compromised CA trust (eMudhra scenario)", () => {
  const url = urlEvidence("https://secure.examplebank-portal.com/");
  const compromised = EMUDHRA_COMPROMISED_KEYS[0]!.spkiSha256;
  const report = assessUrl({
    reportId: ID, createdAt: NOW,
    collection: {
      url,
      redirects: [{ url: url.normalized, status: 200, host: url.hostname, address: "203.0.113.50", location: null, error: null }],
      page: page(url.normalized),
      tls: tls(url.hostname, {
        chain: [
          cert({ subject: `CN=${url.hostname}`, subjectAltNames: [url.hostname], issuer: "C=IN, O=eMudhra Limited, CN=emSign TLS CA - G3", issuerOrganization: "eMudhra Limited", hasEmbeddedScts: false }),
          cert({ position: 1, subject: "C=IN, O=eMudhra Limited, CN=emSign TLS CA - G3", isCa: true, spkiSha256: compromised, fingerprintSha256: "33:44" }),
        ],
      }),
      ct: { source: "crt.sh", status: "completed", detail: "fixture", totalCertificates: 0, issuedLast30Days: 0, issuers: [], leafLogged: false },
      intel: NOT_LISTED,
      checks: urlChecks(),
    },
  });

  it("matches the published compromised key and separates it from configuration problems", () => {
    const ids = report.findings.map((finding) => finding.ruleId);
    expect(ids).toContain("tls.compromised_ca_key");
    expect(ids).toContain("tls.not_in_ct");
    expect(report.dimensions.tls?.status).toBe("critical");
    expect(report.risk.classification).toBe("high_risk");
    expect(report.findings.find((finding) => finding.ruleId === "tls.compromised_ca_key")?.source.type).toBe("certificate_intel");
  });
});
