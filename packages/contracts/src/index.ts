import { z } from "zod";

/** Report schema version. Bump when the canonical report shape changes. */
export const REPORT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

export const MAX_TARGET_LENGTH = 2048;
export const MAX_MESSAGE_LENGTH = 20_000;

export const urlInvestigationSchema = z.object({
  kind: z.literal("url"),
  target: z
    .string()
    .trim()
    .min(3, "Enter a URL or domain to investigate")
    .max(MAX_TARGET_LENGTH, "The URL is too long"),
  /** Optional report this investigation revises (re-investigation of the same target). */
  parentReportId: z.uuid().optional(),
});

export const messageInvestigationSchema = z.object({
  kind: z.literal("message"),
  text: z
    .string()
    .trim()
    .min(12, "Paste at least a sentence of the message")
    .max(MAX_MESSAGE_LENGTH, "The message is too long. Paste the relevant part (up to 20,000 characters)."),
  sender: z.string().trim().max(320).optional(),
  subject: z.string().trim().max(500).optional(),
});

export const investigationRequestSchema = z.discriminatedUnion("kind", [
  urlInvestigationSchema,
  messageInvestigationSchema,
]);

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export const riskClassSchema = z.enum([
  "low_risk",
  "suspicious",
  "high_risk",
  "confirmed_malicious",
  "inconclusive",
]);

export const RISK_LABELS: Record<z.infer<typeof riskClassSchema>, string> = {
  low_risk: "Low Risk",
  suspicious: "Suspicious",
  high_risk: "High Risk",
  confirmed_malicious: "Confirmed Malicious",
  inconclusive: "Inconclusive",
};

export const RISK_DESCRIPTIONS: Record<z.infer<typeof riskClassSchema>, string> = {
  low_risk: "No significant malicious indicators were identified within the checks that completed. This is not a guarantee of safety.",
  suspicious: "One or more indicators require further investigation before you trust this.",
  high_risk: "Multiple significant indicators suggest a substantial security threat.",
  confirmed_malicious: "Supported by authoritative threat intelligence or sufficiently validated evidence.",
  inconclusive: "Insufficient data or unavailable verification sources prevent an assessment.",
};

export const severitySchema = z.enum(["info", "low", "medium", "high", "critical"]);

export const findingCategorySchema = z.enum([
  "phishing",
  "domain",
  "redirect",
  "tls",
  "configuration",
  "intelligence",
  "message",
  "correlation",
]);

export const evidenceConfidenceSchema = z.enum(["low", "medium", "high"]);

export const sourceTypeSchema = z.enum([
  "veriq_rule",
  "threat_intel",
  "certificate_intel",
  "community",
  "network_observation",
]);

export const findingSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleVersion: z.number().int(),
  category: findingCategorySchema,
  severity: severitySchema,
  title: z.string(),
  /** What was observed. */
  description: z.string(),
  /** Why it matters. */
  impact: z.string(),
  /** What the user or site owner should do. */
  recommendation: z.string(),
  evidence: z.array(z.object({ label: z.string(), value: z.string() })),
  source: z.object({
    name: z.string(),
    type: sourceTypeSchema,
    reference: z.string().optional(),
    observedAt: z.string().optional(),
  }),
  /** True only when an authoritative source matched exactly (e.g. URL listed in a threat feed). */
  authoritative: z.boolean(),
  confidence: evidenceConfidenceSchema,
});

export const checkStatusSchema = z.enum(["completed", "unavailable", "failed", "skipped", "blocked"]);

export const checkSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: checkStatusSchema,
  detail: z.string(),
  source: z.string().optional(),
  durationMs: z.number().int().optional(),
  /** Core checks determine whether a Low Risk result is possible at all. */
  core: z.boolean(),
});

export const dimensionStatusSchema = z.enum(["clear", "concern", "critical", "unavailable", "not_applicable"]);

export const dimensionSchema = z.object({
  status: dimensionStatusSchema,
  note: z.string(),
});

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const urlEvidenceSchema = z.object({
  input: z.string(),
  normalized: z.string(),
  scheme: z.string(),
  hostname: z.string(),
  unicodeHostname: z.string(),
  registrableDomain: z.string().nullable(),
  publicSuffix: z.string().nullable(),
  subdomain: z.string().nullable(),
  port: z.number().int().nullable(),
  isIp: z.boolean(),
  hadUserinfo: z.boolean(),
  path: z.string(),
  query: z.string(),
});

export const dnsEvidenceSchema = z.object({
  addresses: z.array(z.string()),
  mx: z.array(z.string()),
  ns: z.array(z.string()),
  cname: z.array(z.string()),
  registration: z
    .object({
      source: z.string(),
      registeredAt: z.string().nullable(),
      ageDays: z.number().int().nullable(),
      registrar: z.string().nullable(),
    })
    .nullable(),
});

export const redirectHopSchema = z.object({
  url: z.string(),
  status: z.number().int().nullable(),
  host: z.string(),
  address: z.string().nullable(),
  location: z.string().nullable(),
  error: z.string().nullable(),
});

export const formEvidenceSchema = z.object({
  action: z.string(),
  actionHost: z.string().nullable(),
  method: z.string(),
  hasPassword: z.boolean(),
  hasPaymentField: z.boolean(),
  hasOtpField: z.boolean(),
});

export const pageEvidenceSchema = z.object({
  finalUrl: z.string(),
  status: z.number().int(),
  contentType: z.string().nullable(),
  bodyBytes: z.number().int(),
  bodySha256: z.string().nullable(),
  title: z.string().nullable(),
  /** Short visible-text excerpt (inert, truncated). */
  textExcerpt: z.string(),
  headers: z.record(z.string(), z.string()),
  setCookies: z.array(z.object({ name: z.string(), secure: z.boolean(), httpOnly: z.boolean(), sameSite: z.string().nullable() })),
  forms: z.array(formEvidenceSchema),
  externalDomains: z.array(z.string()),
  resourceDomains: z.array(z.string()),
  mixedContent: z.object({ active: z.number().int(), passive: z.number().int() }),
  metaRefresh: z.string().nullable(),
  scriptRedirectHint: z.boolean(),
  generator: z.string().nullable(),
  brandMentions: z.array(z.string()),
});

export const certificateSummarySchema = z.object({
  position: z.number().int(),
  subject: z.string(),
  issuer: z.string(),
  issuerOrganization: z.string().nullable(),
  serialNumber: z.string(),
  validFrom: z.string(),
  validTo: z.string(),
  daysRemaining: z.number().int(),
  subjectAltNames: z.array(z.string()),
  publicKeyAlgorithm: z.string(),
  publicKeyBits: z.number().int().nullable(),
  curve: z.string().nullable(),
  signatureAlgorithm: z.string().nullable(),
  fingerprintSha256: z.string(),
  spkiSha256: z.string().nullable(),
  selfSigned: z.boolean(),
  isCa: z.boolean(),
  hasEmbeddedScts: z.boolean(),
});

export const tlsEvidenceSchema = z.object({
  host: z.string(),
  address: z.string().nullable(),
  protocol: z.string().nullable(),
  cipher: z.string().nullable(),
  authorized: z.boolean(),
  authorizationError: z.string().nullable(),
  hostnameMatch: z.boolean(),
  ocspStapled: z.boolean(),
  chain: z.array(certificateSummarySchema),
});

export const ctEvidenceSchema = z.object({
  source: z.string(),
  status: z.enum(["completed", "unavailable"]),
  detail: z.string(),
  totalCertificates: z.number().int().nullable(),
  issuedLast30Days: z.number().int().nullable(),
  issuers: z.array(z.string()),
  leafLogged: z.boolean().nullable(),
});

export const intelResultSchema = z.object({
  source: z.string(),
  status: z.enum(["listed", "not_listed", "unavailable", "error", "disabled"]),
  matchScope: z.string(),
  detail: z.string(),
  checkedAt: z.string(),
  reference: z.string().optional(),
});

export const extractedIndicatorSchema = z.object({
  type: z.enum(["url", "email", "phone", "upi", "crypto_wallet", "ifsc", "amount"]),
  /** Redacted display value safe to show and store in reports. */
  display: z.string(),
  /** SHA-256 of the normalised raw value, used for correlation without storing the raw value. */
  hash: z.string(),
});

export const messageCueSchema = z.object({
  cue: z.string(),
  label: z.string(),
  matches: z.array(z.string()),
});

export const messageEvidenceSchema = z.object({
  characters: z.number().int(),
  redactedExcerpt: z.string(),
  senderDomain: z.string().nullable(),
  claimedBrands: z.array(z.string()),
  indicators: z.array(extractedIndicatorSchema),
  links: z.array(z.object({ display: z.string(), normalized: z.string().nullable(), registrableDomain: z.string().nullable() })),
  cues: z.array(messageCueSchema),
  protectiveLanguage: z.array(z.string()),
});

export const relatedReportSchema = z.object({
  publicId: z.string(),
  classification: riskClassSchema,
  createdAt: z.string(),
  matches: z.array(z.object({ type: z.string(), display: z.string(), method: z.string() })),
  strength: z.enum(["weak", "moderate", "strong"]),
  note: z.string(),
});

export const aiAnalysisSchema = z.object({
  status: z.enum(["generated", "disabled", "unavailable", "rejected"]),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  promptVersion: z.string(),
  summary: z.string(),
  explanations: z.array(z.object({ findingId: z.string(), text: z.string() })),
  observations: z.array(z.object({ text: z.string(), findingIds: z.array(z.string()) })),
  discarded: z.number().int(),
  note: z.string(),
});

export const reportSchema = z.object({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  reportId: z.uuid(),
  parentReportId: z.uuid().nullable(),
  kind: z.enum(["url", "message"]),
  createdAt: z.string(),
  subject: z.object({ display: z.string(), registrableDomain: z.string().nullable() }),
  risk: z.object({
    classification: riskClassSchema,
    label: z.string(),
    summary: z.string(),
    rationale: z.array(z.string()),
    confidence: evidenceConfidenceSchema,
  }),
  coverage: z.object({
    completed: z.number().int(),
    total: z.number().int(),
    unavailable: z.array(z.string()),
  }),
  dimensions: z.record(z.string(), dimensionSchema),
  findings: z.array(findingSchema),
  checks: z.array(checkSchema),
  evidence: z.object({
    url: urlEvidenceSchema.optional(),
    dns: dnsEvidenceSchema.optional(),
    redirects: z.array(redirectHopSchema).optional(),
    page: pageEvidenceSchema.optional(),
    tls: tlsEvidenceSchema.optional(),
    ct: ctEvidenceSchema.optional(),
    intel: z.array(intelResultSchema).optional(),
    message: messageEvidenceSchema.optional(),
  }),
  related: z.array(relatedReportSchema),
  ai: aiAnalysisSchema,
  recommendations: z.array(z.string()),
  limitations: z.array(z.string()),
  versions: z.object({
    engine: z.string(),
    rules: z.string(),
    policy: z.string(),
    datasets: z.record(z.string(), z.string()),
  }),
});

// ---------------------------------------------------------------------------
// Registry / verification
// ---------------------------------------------------------------------------

export const registryStatusSchema = z.enum(["unregistered", "pending", "confirmed", "failed", "unavailable"]);

export const registryReceiptSchema = z.object({
  status: registryStatusSchema,
  chainId: z.number().int().nullable(),
  contractAddress: z.string().nullable(),
  registryKey: z.string().nullable(),
  commitment: z.string().nullable(),
  parentKey: z.string().nullable(),
  transactionHash: z.string().nullable(),
  blockNumber: z.number().int().nullable(),
  registeredAt: z.string().nullable(),
  error: z.string().nullable(),
});

export const verificationBundleSchema = z.object({
  bundleVersion: z.literal(1),
  algorithm: z.literal("veriq-commitment-v1"),
  report: reportSchema,
  nonce: z.string().regex(/^0x[0-9a-f]{64}$/),
  registryKey: z.string().regex(/^0x[0-9a-f]{64}$/),
  commitment: z.string().regex(/^0x[0-9a-f]{64}$/),
  registry: z.object({
    chainId: z.number().int().nullable(),
    contractAddress: z.string().nullable(),
    transactionHash: z.string().nullable(),
    rpcHint: z.string().nullable(),
  }),
});

export const publicationReviewSchema = z.object({
  available: z.boolean(),
  authentic: z.boolean(),
  important: z.boolean(),
  reason: z.string().max(400),
});

export const registerRequestSchema = z.object({
  publishToRepository: z.boolean().default(false),
  note: z.string().trim().max(280).optional(),
  /** Set only after the signer has seen the model review and chosen to publish. */
  confirmPublication: z.boolean().optional(),
  /** A wallet-submitted transaction. The backend independently checks its receipt and commitment. */
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
});

export const registrationPlanSchema = z.object({
  chainId: z.number().int().positive(),
  contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  registryKey: z.string().regex(/^0x[0-9a-f]{64}$/),
  commitment: z.string().regex(/^0x[0-9a-f]{64}$/),
  parentKey: z.string().regex(/^0x[0-9a-f]{64}$/),
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
});

export const statementRequestSchema = z.object({
  kind: z.enum(["validate", "dispute"]),
  note: z.string().trim().min(3).max(280),
});

export const repositoryEntrySchema = z.object({
  publicId: z.string(),
  kind: z.enum(["url", "message"]),
  classification: riskClassSchema,
  createdAt: z.string(),
  summary: z.string(),
  note: z.string().nullable(),
  indicators: z.array(z.object({ type: z.string(), display: z.string(), hash: z.string() })),
  registry: registryReceiptSchema,
  statements: z.array(
    z.object({
      kind: z.enum(["validate", "dispute"]),
      note: z.string(),
      statementHash: z.string(),
      transactionHash: z.string().nullable(),
      status: registryStatusSchema,
      createdAt: z.string(),
    }),
  ),
  clusterId: z.string().nullable(),
});

export const correlationClusterSchema = z.object({
  clusterId: z.string(),
  members: z.array(z.string()),
  sharedIndicators: z.array(z.object({ type: z.string(), display: z.string(), method: z.string(), reports: z.number().int() })),
  strength: z.enum(["weak", "moderate", "strong"]),
  summary: z.string(),
});

export const publicErrorSchema = z.object({
  code: z.string(),
  title: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  correlationId: z.string(),
  review: publicationReviewSchema.optional(),
});

export const investigationResponseSchema = z.object({
  report: reportSchema,
  registry: registryReceiptSchema,
  publishedToRepository: z.boolean(),
});

export const myInvestigationSchema = z.object({
  reportId: z.uuid(),
  kind: z.enum(["url", "message"]),
  subject: z.string(),
  classification: riskClassSchema,
  label: z.string(),
  createdAt: z.string(),
  findings: z.number().int(),
  registry: registryStatusSchema,
  published: z.boolean(),
});

export const myInvestigationsResponseSchema = z.object({
  user: z.object({ id: z.string(), email: z.string().nullable() }),
  items: z.array(myInvestigationSchema),
  totals: z.object({
    investigations: z.number().int(),
    registered: z.number().int(),
    published: z.number().int(),
    byClass: z.record(z.string(), z.number().int()),
  }),
});

export type MyInvestigation = z.infer<typeof myInvestigationSchema>;
export type MyInvestigationsResponse = z.infer<typeof myInvestigationsResponseSchema>;

export const serviceConfigSchema = z.object({
  ai: z.object({ enabled: z.boolean() }),
  auth: z.object({ enabled: z.boolean() }),
  intel: z.array(z.object({ name: z.string(), enabled: z.boolean(), detail: z.string() })),
  registry: z.object({
    available: z.boolean(),
    chainId: z.number().int().nullable(),
    contractAddress: z.string().nullable(),
    rpcUrl: z.string().nullable(),
    detail: z.string(),
  }),
});

export type InvestigationRequest = z.infer<typeof investigationRequestSchema>;
export type UrlInvestigation = z.infer<typeof urlInvestigationSchema>;
export type MessageInvestigation = z.infer<typeof messageInvestigationSchema>;
export type RiskClass = z.infer<typeof riskClassSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type FindingCategory = z.infer<typeof findingCategorySchema>;
export type EvidenceConfidence = z.infer<typeof evidenceConfidenceSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Check = z.infer<typeof checkSchema>;
export type CheckStatus = z.infer<typeof checkStatusSchema>;
export type Dimension = z.infer<typeof dimensionSchema>;
export type UrlEvidence = z.infer<typeof urlEvidenceSchema>;
export type DnsEvidence = z.infer<typeof dnsEvidenceSchema>;
export type RedirectHop = z.infer<typeof redirectHopSchema>;
export type FormEvidence = z.infer<typeof formEvidenceSchema>;
export type PageEvidence = z.infer<typeof pageEvidenceSchema>;
export type CertificateSummary = z.infer<typeof certificateSummarySchema>;
export type TlsEvidence = z.infer<typeof tlsEvidenceSchema>;
export type CtEvidence = z.infer<typeof ctEvidenceSchema>;
export type IntelResult = z.infer<typeof intelResultSchema>;
export type ExtractedIndicator = z.infer<typeof extractedIndicatorSchema>;
export type MessageCue = z.infer<typeof messageCueSchema>;
export type MessageEvidence = z.infer<typeof messageEvidenceSchema>;
export type RelatedReport = z.infer<typeof relatedReportSchema>;
export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;
export type Report = z.infer<typeof reportSchema>;
export type RegistryStatus = z.infer<typeof registryStatusSchema>;
export type RegistryReceipt = z.infer<typeof registryReceiptSchema>;
export type VerificationBundle = z.infer<typeof verificationBundleSchema>;
export type PublicationReview = z.infer<typeof publicationReviewSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type RegistrationPlan = z.infer<typeof registrationPlanSchema>;
export type StatementRequest = z.infer<typeof statementRequestSchema>;
export type RepositoryEntry = z.infer<typeof repositoryEntrySchema>;
export type CorrelationCluster = z.infer<typeof correlationClusterSchema>;
export type PublicError = z.infer<typeof publicErrorSchema>;
export type InvestigationResponse = z.infer<typeof investigationResponseSchema>;
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;
