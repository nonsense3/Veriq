/**
 * Certificate-authority trust intelligence. Every entry names its source so a finding can cite it.
 * Matching scopes are deliberately explicit: a public-key (SPKI) match is exact; an issuer-name
 * match is a weaker, scoped signal and is reported as such.
 */

export const CA_DATASET_VERSION = "ca-trust-2026.11.07";

export type CompromisedKey = { spkiSha256: string; label: string };

/**
 * eMudhra / emSign intermediate CA keys disclosed on 17 October 2026. The private scalars were
 * published (d = 4, 56, 66, 115, 155, 156, 230, 237 on P-384), so these public keys are known to be
 * compromised. Hashes are SHA-256 over the DER SubjectPublicKeyInfo of d·G and are re-derived in the
 * scanner test-suite from the published scalars. This is matching against a published advisory; Veriq
 * does not claim to detect a CA's key-generation weakness by itself.
 */
export const EMUDHRA_COMPROMISED_KEYS: CompromisedKey[] = [
  { spkiSha256: "63ecefee431d49523bc1136c4e72d0206a477086caf606cd5cf025686c109cf8", label: "eMudhra intermediate (published weak key d=4)" },
  { spkiSha256: "5c0660a2b164910d8ff589c18e14552e9e0ec237dcefe2cb736d41a4811f81a0", label: "eMudhra intermediate (published weak key d=56)" },
  { spkiSha256: "ec4ffa1ad0ac88081314b7aaffef6a91f97cd57291bb5ba686c5415f5eb4f6b6", label: "eMudhra intermediate (published weak key d=66)" },
  { spkiSha256: "e0254c7fcdc265e2f0f8a428dabb75ab4ae039b4872d62f5ee57f0877d5a8a41", label: "eMudhra intermediate (published weak key d=115)" },
  { spkiSha256: "43bffa19d6ef651451f6841e019931e96f6f2eaeff28ab4b6f1ce4576de2717b", label: "eMudhra intermediate (published weak key d=155)" },
  { spkiSha256: "ebed6475c2c2d80fcb199f3fe8dd6e6b3ce60b77eb15d4e42c3dec0c6f5b5105", label: "eMudhra intermediate (published weak key d=156)" },
  { spkiSha256: "49dd353dc2b919a3770645117d0e60c16115e7d1bc259eefe734b00ea434fe5f", label: "eMudhra intermediate (published weak key d=230)" },
  { spkiSha256: "92c063d67e8f14db71d288e11266ffdaf69cbf115f7bab14f3bc2f68d25e0e30", label: "eMudhra intermediate (published weak key d=237)" },
];

export const EMUDHRA_SCALARS = [4, 56, 66, 115, 155, 156, 230, 237];

export const EMUDHRA_SOURCES = [
  "https://blog.cloudflare.com/emudhra-certificate-compromise/",
  "https://blog.qualys.com/product-tech/2026/10/23/how-to-identify-compromised-emudhra-certificates-with-qualys-cve-2026-111943-and-cve-2026-111944",
  "https://www.dsci.in/files/content/advisory/2026/eMudhra%20Intermediate%20CA%20issue.pdf",
];

/** Root certificates removed from browser trust (SHA-256 of the certificate DER, uppercase hex). */
export const DISTRUSTED_ROOTS: Array<{ fingerprint: string; name: string; severity: "high" | "low"; note: string; source: string }> = [
  { fingerprint: "86A1ECBA089C4A8D3BBE2734C612BA341D813E043CF9E8A862CD5C57A36BBE6B", name: "emSign ECC Root CA - G3", severity: "high", note: "Removed from Mozilla NSS 3.131.1 after the October 2026 eMudhra key compromise.", source: EMUDHRA_SOURCES[0]! },
  { fingerprint: "7DD78D5F4F13459A83DFF9ABBBA62EDBAF6F2D102BF257FD712F4D9F2746ED8D", name: "emSign Root TLS CA - G3", severity: "high", note: "Direct issuer of the compromised eMudhra TLS intermediates (October 2026).", source: EMUDHRA_SOURCES[0]! },
  { fingerprint: "F2EDAAFF3D9B701FB4D14C9F285F8C0BAD90FC3BCC1FA07D47F4718EDABA34A5", name: "emSign Root CS CA - G3", severity: "high", note: "Code-signing root in the affected eMudhra hierarchy.", source: EMUDHRA_SOURCES[0]! },
  { fingerprint: "D7A7A0FB5D7E2731D771E9484EBCDEF71D5F0C3E0A2948782BC83EE0EA699EF4", name: "AAA Certificate Services (Sectigo legacy)", severity: "low", note: "Legacy root that cross-signed the affected eMudhra intermediates; no longer trusted for websites by Chrome and Firefox. Legitimate legacy Sectigo chains also use it.", source: EMUDHRA_SOURCES[0]! },
];

/** Issuer organisations distrusted by major root programs. Name matching is scoped and lower confidence. */
export const DISTRUSTED_ISSUERS: Array<{ pattern: RegExp; name: string; issuedAfter?: string; note: string }> = [
  { pattern: /diginotar/i, name: "DigiNotar", note: "Compromised in 2011 and removed from all root stores." },
  { pattern: /wosign/i, name: "WoSign", note: "Distrusted by Mozilla, Apple and Google in 2016–2017 for mis-issuance and backdating." },
  { pattern: /startcom/i, name: "StartCom", note: "Distrusted together with WoSign in 2016–2017." },
  { pattern: /trustcor/i, name: "TrustCor", note: "Removed from Mozilla and Chrome root stores in 2022–2023." },
  { pattern: /camerfirma/i, name: "AC Camerfirma", note: "Distrusted by Mozilla and Chrome in 2021 after repeated compliance failures." },
  { pattern: /e-tugra/i, name: "E-Tugra", note: "Distrusted in 2023 after a security incident." },
  { pattern: /entrust/i, name: "Entrust (public TLS)", issuedAfter: "2024-11-12T00:00:00Z", note: "Chrome and Mozilla stopped trusting Entrust TLS certificates issued after November 2024." },
  { pattern: /emudhra|emsign/i, name: "eMudhra / emSign", note: "Eight eMudhra intermediate keys were compromised in October 2026; eMudhra exited the public TLS business." },
];
