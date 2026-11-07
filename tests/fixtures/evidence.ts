import type { CertificateSummary, Check, PageEvidence, TlsEvidence } from "../../packages/contracts/src/index";

/** Controlled, synthetic evidence for the required scenarios. No live site is contacted. */

export function cert(overrides: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    position: 0,
    subject: "CN=example.test",
    issuer: "C=US, O=Let's Encrypt, CN=R11",
    issuerOrganization: "Let's Encrypt",
    serialNumber: "04A1B2C3D4",
    validFrom: "2026-10-01T00:00:00.000Z",
    validTo: "2026-12-30T00:00:00.000Z",
    daysRemaining: 53,
    subjectAltNames: ["example.test"],
    publicKeyAlgorithm: "ec",
    publicKeyBits: 256,
    curve: "prime256v1",
    signatureAlgorithm: "ecdsa-with-SHA256",
    fingerprintSha256: "AA:BB:CC:DD",
    spkiSha256: "00".repeat(32),
    selfSigned: false,
    isCa: false,
    hasEmbeddedScts: true,
    ...overrides,
  };
}

export function tls(host: string, overrides: Partial<TlsEvidence> = {}): TlsEvidence {
  return {
    host,
    address: "203.0.113.10",
    protocol: "TLSv1.3",
    cipher: "TLS_AES_128_GCM_SHA256",
    authorized: true,
    authorizationError: null,
    hostnameMatch: true,
    ocspStapled: false,
    chain: [cert({ subject: `CN=${host}`, subjectAltNames: [host] }), cert({ position: 1, subject: "C=US, O=Let's Encrypt, CN=R11", issuer: "C=US, O=Internet Security Research Group, CN=ISRG Root X1", isCa: true, fingerprintSha256: "11:22", hasEmbeddedScts: false })],
    ...overrides,
  };
}

export const SECURE_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export function page(finalUrl: string, overrides: Partial<PageEvidence> = {}): PageEvidence {
  return {
    finalUrl,
    status: 200,
    contentType: "text/html; charset=utf-8",
    bodyBytes: 12_000,
    bodySha256: "ab".repeat(32),
    title: "Welcome",
    textExcerpt: "Welcome to our site.",
    headers: SECURE_HEADERS,
    setCookies: [],
    forms: [],
    externalDomains: [],
    resourceDomains: [],
    mixedContent: { active: 0, passive: 0 },
    metaRefresh: null,
    scriptRedirectHint: false,
    generator: null,
    brandMentions: [],
    ...overrides,
  };
}

export function urlChecks(overrides: Partial<Record<string, Check["status"]>> = {}): Check[] {
  const make = (id: string, label: string, core: boolean): Check => ({ id, label, status: overrides[id] ?? "completed", detail: "fixture", core });
  return [
    make("lexical", "Link structure analysis", false),
    make("dns", "DNS resolution", false),
    make("rdap", "Domain registration (RDAP)", false),
    make("http", "Passive HTTP inspection", true),
    make("headers", "Security headers & configuration", false),
    make("tls", "TLS certificate inspection", false),
    make("ct", "Certificate Transparency (crt.sh)", false),
    make("intel", "Threat intelligence", true),
  ];
}

export const NOT_LISTED = [{ source: "OpenPhish community feed", status: "not_listed" as const, matchScope: "exact URL / host", detail: "Not listed (fixture feed).", checkedAt: "2026-11-07T08:00:00.000Z" }];
