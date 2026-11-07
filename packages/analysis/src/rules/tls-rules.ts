import type { CertificateSummary, CtEvidence, TlsEvidence } from "@veriq/contracts";
import { CA_DATASET_VERSION, DISTRUSTED_ISSUERS, DISTRUSTED_ROOTS, EMUDHRA_COMPROMISED_KEYS, EMUDHRA_SOURCES } from "../data/ca-trust";
import { draft, type FindingDraft } from "../finding";

const WEAK_SIGNATURES = /(md5|sha1)(with|-)?(rsa|ecdsa)?/i;

const certSource = (reference: string) => ({ name: "Veriq CA trust dataset", type: "certificate_intel" as const, reference: `${CA_DATASET_VERSION} · ${reference}` });

function describeCert(cert: CertificateSummary): string {
  return cert.position === 0 ? "the site's certificate" : `chain certificate #${cert.position} (${cert.subject})`;
}

/**
 * Certificate and connection rules. Configuration failures (expired, mismatched, incomplete chain) are kept
 * separate from compromise findings, which require a match against published CA-incident intelligence.
 */
export function analyzeTls(tls: TlsEvidence, ct: CtEvidence | undefined): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const leaf = tls.chain[0];
  const error = tls.authorizationError ?? "";

  // --- compromised trust (advisory-backed) -------------------------------------------------------
  for (const cert of tls.chain) {
    const compromised = cert.spkiSha256 ? EMUDHRA_COMPROMISED_KEYS.find((key) => key.spkiSha256 === cert.spkiSha256) : undefined;
    if (compromised) {
      findings.push(draft({
        ruleId: "tls.compromised_ca_key", category: "tls", severity: "critical",
        title: "Certificate chain uses a publicly compromised CA key",
        description: `${describeCert(cert)} carries a public key that matches ${compromised.label}. Its private key is publicly recoverable, so anyone can forge certificates under it.`,
        impact: "A valid-looking HTTPS connection through this chain does not prove you are talking to the real server; interception and impersonation are possible.",
        recommendation: "Do not trust this connection. Update your browser/OS trust store; site owners must replace the certificate with one from an unaffected CA.",
        evidence: [{ label: "Certificate", value: cert.subject }, { label: "SPKI SHA-256", value: cert.spkiSha256 ?? "" }, { label: "Match scope", value: "Exact public-key match against published compromised keys" }],
        source: certSource(EMUDHRA_SOURCES[0]!), confidence: "high",
      }));
    }
    const root = DISTRUSTED_ROOTS.find((entry) => entry.fingerprint === cert.fingerprintSha256.replace(/:/g, "").toUpperCase());
    if (root) {
      findings.push(draft({
        ruleId: "tls.distrusted_root", category: "tls", severity: root.severity,
        title: `Chain includes distrusted root: ${root.name}`,
        description: `${describeCert(cert)} is ${root.name}. ${root.note}`,
        impact: root.severity === "high" ? "Up-to-date browsers reject this chain; older clients may still accept forged certificates." : "Context only: this root also anchors legitimate legacy chains.",
        recommendation: "Site owners should move to a chain anchored in a currently trusted root.",
        evidence: [{ label: "Fingerprint", value: cert.fingerprintSha256 }, { label: "Match scope", value: "Exact certificate fingerprint" }],
        source: certSource(root.source), confidence: "high",
      }));
    }
  }
  if (leaf) {
    const issuerText = `${leaf.issuer} ${leaf.issuerOrganization ?? ""} ${tls.chain.map((cert) => cert.issuer).join(" ")}`;
    const issuer = DISTRUSTED_ISSUERS.find((entry) => entry.pattern.test(issuerText) && (!entry.issuedAfter || Date.parse(leaf.validFrom) > Date.parse(entry.issuedAfter)));
    if (issuer && !findings.some((finding) => finding.ruleId === "tls.compromised_ca_key")) {
      findings.push(draft({
        ruleId: "tls.distrusted_issuer", category: "tls", severity: issuer.name.startsWith("eMudhra") ? "medium" : "high",
        title: `Issued under a distrusted CA: ${issuer.name}`,
        description: `The issuer chain names ${issuer.name}. ${issuer.note}`,
        impact: "Certificates from distrusted authorities may be rejected by browsers or may not reliably prove server identity.",
        recommendation: "Site owners should reissue the certificate from a currently trusted CA.",
        evidence: [{ label: "Issuer", value: leaf.issuer }, { label: "Match scope", value: "Issuer-name match (no key-level evidence)" }],
        source: certSource("root-program distrust announcements"), confidence: "medium",
      }));
    }
  }

  // --- validity and identity (configuration-level) -----------------------------------------------
  if (error === "CERT_HAS_EXPIRED" || (leaf && leaf.daysRemaining < 0)) {
    findings.push(draft({
      ruleId: "tls.expired", category: "tls", severity: "medium",
      title: "Certificate has expired",
      description: leaf ? `The certificate expired on ${leaf.validTo}.` : "The server presented an expired certificate.",
      impact: "Browsers warn users; an expired certificate no longer proves the server's identity.",
      recommendation: "Do not bypass the browser warning. Site owners must renew the certificate.",
      evidence: leaf ? [{ label: "Valid to", value: leaf.validTo }] : [], confidence: "high",
    }));
  } else if (error === "CERT_NOT_YET_VALID") {
    findings.push(draft({
      ruleId: "tls.not_yet_valid", category: "tls", severity: "medium",
      title: "Certificate is not yet valid",
      description: "The certificate's validity period starts in the future.",
      impact: "Indicates a misconfigured clock or an improperly issued certificate.",
      recommendation: "Do not bypass the browser warning.",
      evidence: leaf ? [{ label: "Valid from", value: leaf.validFrom }] : [],
    }));
  } else if (leaf && leaf.daysRemaining <= 14) {
    findings.push(draft({
      ruleId: "tls.expiring_soon", category: "configuration", severity: "low",
      title: "Certificate expires soon",
      description: `The certificate expires in ${leaf.daysRemaining} day(s).`,
      impact: "Operational risk for the site owner; not an indicator of malice.",
      recommendation: "Site owner: renew or automate renewal.",
      evidence: [{ label: "Valid to", value: leaf.validTo }],
    }));
  }
  if (!tls.hostnameMatch) {
    findings.push(draft({
      ruleId: "tls.hostname_mismatch", category: "tls", severity: "medium",
      title: "Certificate does not match the host name",
      description: `The certificate is not valid for ${tls.host}.${leaf ? ` It covers ${leaf.subjectAltNames.slice(0, 4).join(", ") || leaf.subject}.` : ""}`,
      impact: "The connection is encrypted but not authenticated for this domain.",
      recommendation: "Do not bypass the browser warning or enter information.",
      evidence: [{ label: "Host", value: tls.host }, { label: "SANs", value: leaf?.subjectAltNames.slice(0, 8).join(", ") ?? "" }], confidence: "high",
    }));
  }
  if (error === "DEPTH_ZERO_SELF_SIGNED_CERT" || (leaf?.selfSigned && tls.chain.length === 1)) {
    findings.push(draft({
      ruleId: "tls.self_signed", category: "tls", severity: "medium",
      title: "Self-signed certificate",
      description: "The server's certificate is not issued by any certificate authority.",
      impact: "Any party can create such a certificate; it proves nothing about identity.",
      recommendation: "Do not trust this connection for sensitive data.",
      evidence: leaf ? [{ label: "Subject", value: leaf.subject }] : [], confidence: "high",
    }));
  } else if (["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN"].includes(error)) {
    findings.push(draft({
      ruleId: "tls.untrusted_chain", category: "tls", severity: "medium",
      title: "Certificate chain is incomplete or not trusted",
      description: `The chain could not be verified against trusted roots (${error}).`,
      impact: "Some clients will refuse the connection; others may accept a forged chain if checks are disabled.",
      recommendation: "Site owners must serve the full intermediate chain from a trusted CA.",
      evidence: [{ label: "Verifier result", value: error }],
    }));
  } else if (error === "CERT_REVOKED") {
    findings.push(draft({
      ruleId: "tls.revoked", category: "tls", severity: "high",
      title: "Certificate has been revoked",
      description: "The issuing authority revoked this certificate.",
      impact: "Revocation usually means key compromise or mis-issuance.",
      recommendation: "Do not trust this connection.",
      evidence: [{ label: "Verifier result", value: error }], confidence: "high",
    }));
  } else if (error && !["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(error)) {
    findings.push(draft({
      ruleId: "tls.verification_failed", category: "tls", severity: "medium",
      title: "Certificate verification failed",
      description: `The TLS verifier reported ${error}.`,
      impact: "The server's identity could not be confirmed.",
      recommendation: "Do not bypass browser warnings.",
      evidence: [{ label: "Verifier result", value: error }],
    }));
  }

  // --- cryptographic strength ------------------------------------------------------------------
  for (const cert of tls.chain) {
    const isRootOnly = cert.selfSigned && cert.position > 0;
    if (cert.publicKeyAlgorithm === "rsa" && cert.publicKeyBits !== null && cert.publicKeyBits < 2048) {
      findings.push(draft({
        ruleId: "tls.weak_rsa_key", category: "tls", severity: "high",
        title: "Weak RSA key size",
        description: `${describeCert(cert)} uses a ${cert.publicKeyBits}-bit RSA key.`,
        impact: "Keys below 2048 bits are considered breakable by well-resourced attackers.",
        recommendation: "Site owners must reissue with at least RSA-2048 or ECDSA P-256.",
        evidence: [{ label: "Key", value: `RSA ${cert.publicKeyBits}` }], confidence: "high",
      }));
    }
    if (cert.publicKeyAlgorithm === "ec" && cert.publicKeyBits !== null && cert.publicKeyBits < 256) {
      findings.push(draft({
        ruleId: "tls.weak_ec_key", category: "tls", severity: "high",
        title: "Weak elliptic-curve key",
        description: `${describeCert(cert)} uses a ${cert.publicKeyBits}-bit curve${cert.curve ? ` (${cert.curve})` : ""}.`,
        impact: "Curves below 256 bits do not meet current security baselines.",
        recommendation: "Site owners must use P-256 or stronger.",
        evidence: [{ label: "Curve", value: cert.curve ?? String(cert.publicKeyBits) }], confidence: "high",
      }));
    }
    if (!isRootOnly && cert.signatureAlgorithm && WEAK_SIGNATURES.test(cert.signatureAlgorithm)) {
      findings.push(draft({
        ruleId: "tls.weak_signature", category: "tls", severity: "high",
        title: "Certificate signed with a broken hash algorithm",
        description: `${describeCert(cert)} is signed with ${cert.signatureAlgorithm}.`,
        impact: "MD5 and SHA-1 collisions allow forged certificates.",
        recommendation: "Site owners must reissue with SHA-256 or stronger.",
        evidence: [{ label: "Signature", value: cert.signatureAlgorithm }], confidence: "high",
      }));
    }
  }
  if (tls.protocol && /^TLSv1(\.[01])?$/.test(tls.protocol)) {
    findings.push(draft({
      ruleId: "tls.legacy_protocol", category: "tls", severity: "medium",
      title: `Server negotiated legacy ${tls.protocol}`,
      description: `The connection used ${tls.protocol}, which is deprecated (RFC 8996).`,
      impact: "Legacy protocols have known weaknesses and are rejected by modern browsers.",
      recommendation: "Site owners must require TLS 1.2 or 1.3.",
      evidence: [{ label: "Protocol", value: tls.protocol }], confidence: "high",
    }));
  }
  if (leaf) {
    const lifetimeDays = Math.round((Date.parse(leaf.validTo) - Date.parse(leaf.validFrom)) / 86_400_000);
    if (lifetimeDays > 398 && Date.parse(leaf.validFrom) > Date.parse("2020-09-01T00:00:00Z") && !leaf.selfSigned) {
      findings.push(draft({
        ruleId: "tls.excessive_lifetime", category: "tls", severity: "low",
        title: "Certificate lifetime exceeds browser limits",
        description: `The certificate is valid for ${lifetimeDays} days; publicly trusted certificates issued after September 2020 are limited to 398 days.`,
        impact: "Suggests a private or non-compliant issuer.",
        recommendation: "Context only; combine with chain-trust results.",
        evidence: [{ label: "Lifetime", value: `${lifetimeDays} days` }],
      }));
    }
    if (!leaf.subjectAltNames.length) {
      findings.push(draft({
        ruleId: "tls.no_san", category: "tls", severity: "low",
        title: "Certificate has no Subject Alternative Names",
        description: "Modern clients match host names only against SANs.",
        impact: "Indicates an outdated or improperly issued certificate.",
        recommendation: "Site owners should reissue with SANs.",
        evidence: [{ label: "Subject", value: leaf.subject }],
      }));
    }
  }

  // --- certificate transparency ------------------------------------------------------------------
  if (leaf && !leaf.selfSigned) {
    if (ct?.status === "completed" && ct.leafLogged === false && !leaf.hasEmbeddedScts) {
      findings.push(draft({
        ruleId: "tls.not_in_ct", category: "tls", severity: "medium",
        title: "Certificate not found in Certificate Transparency logs",
        description: "The presented certificate carries no embedded SCTs and was not found in the CT search results.",
        impact: "Publicly trusted certificates are expected to be logged. An unlogged certificate can indicate unexpected or fraudulent issuance (the eMudhra-chained forgeries were never logged).",
        recommendation: "Treat the connection's identity as unverified.",
        evidence: [{ label: "Serial", value: leaf.serialNumber }, { label: "CT source", value: ct.source }],
        source: { name: ct.source, type: "certificate_intel", reference: "https://crt.sh" },
      }));
    }
    if (ct?.status === "completed" && ct.issuers.length >= 3 && leaf.issuerOrganization && !ct.issuers.some((name) => name.toLowerCase().includes(leaf.issuerOrganization!.toLowerCase()))) {
      findings.push(draft({
        ruleId: "tls.unexpected_issuer", category: "tls", severity: "low",
        title: "Certificate issuer differs from this domain's history",
        description: `CT logs show earlier certificates from ${ct.issuers.slice(0, 3).join(", ")}, but the current certificate is from ${leaf.issuerOrganization}.`,
        impact: "A sudden change of CA can be routine or can indicate unexpected issuance.",
        recommendation: "Domain owners should confirm they requested this certificate.",
        evidence: [{ label: "Current issuer", value: leaf.issuerOrganization }],
        source: { name: ct.source, type: "certificate_intel", reference: "https://crt.sh" }, confidence: "low",
      }));
    }
  }
  return findings;
}
