import type { UrlEvidence } from "@veriq/contracts";
import { BRANDS, HIGH_ABUSE_TLDS, URL_SHORTENERS, isOfficialDomain, sharedHostingPlatform, type Brand } from "../brands";
import { draft, type FindingDraft } from "../finding";
import { levenshtein, scriptsIn, shannonEntropy, skeleton } from "../text";
import { normalizeTarget, registrableLabel } from "../url";

const CREDENTIAL_WORDS = ["login", "log-in", "signin", "sign-in", "verify", "verification", "account", "secure", "update", "kyc", "wallet", "confirm", "password", "banking", "unlock", "suspend", "suspended", "recover", "billing", "auth", "otp", "refund", "claim"];
const REDIRECT_PARAMS = new Set(["url", "redirect", "redirect_uri", "redirect_url", "redir", "next", "continue", "dest", "destination", "u", "r", "target", "goto", "returnurl", "return", "return_to", "out", "link", "to"]);

export type BrandSignal = { brand: Brand; kind: "exact_token" | "lookalike" | "subdomain" | "path" | "homograph" };

/** Filler words phishing domains glue onto a brand ("paypalsecure", "sbi-kyc-update"). */
const GLUE_WORDS = ["secure", "security", "login", "signin", "verify", "verification", "support", "help", "service", "services", "online", "account", "accounts", "update", "auth", "india", "my", "web", "official", "app", "pay", "bank", "banking", "customer", "care", "team", "center", "centre", "desk", "portal", "kyc", "net", "info", "alert", "alerts", "notice", "refund", "reward", "rewards", "claim", "billing", "id", "user", "mail", "unlock", "confirm", "wallet", "gift", "prize", "delivery", "track", "tracking", "parcel", "in", "co", "e", "m", "go", "get"];

/** True when `label` is the brand token plus only filler words and digits. */
function isBrandPlusGlue(label: string, token: string): boolean {
  let rest = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!rest.includes(token)) return false;
  rest = rest.replace(token, "").replace(/\d+/g, "");
  for (const word of [...GLUE_WORDS].sort((a, b) => b.length - a.length)) rest = rest.split(word).join("");
  return rest.length === 0;
}

function tokensOf(label: string): string[] {
  return label.toLowerCase().split(/[^a-z0-9\u00c0-\uffff]+/).filter(Boolean);
}

/** Detect brand names or lookalikes in a domain that the brand does not operate. */
export function brandSignals(u: UrlEvidence): BrandSignal[] {
  if (u.isIp) return [];
  const signals: BrandSignal[] = [];
  const unicodeRegistrable = u.registrableDomain ? u.unicodeHostname.split(".").slice(-u.registrableDomain.split(".").length).join(".") : "";
  const label = registrableLabel({ registrableDomain: unicodeRegistrable || u.registrableDomain, publicSuffix: u.publicSuffix });
  const labelTokens = tokensOf(label);
  const labelSkeleton = skeleton(label);
  const subTokens = tokensOf(u.subdomain ?? "");
  const pathTokens = tokensOf(decodeURIComponentSafe(u.path));

  for (const brand of BRANDS) {
    if (isOfficialDomain(brand, u.registrableDomain, u.hostname)) continue;
    let matched: BrandSignal["kind"] | null = null;
    for (const token of brand.tokens) {
      if (labelTokens.includes(token)) {
        matched = "exact_token";
        break;
      }
      if (token.length >= 3 && isBrandPlusGlue(label, token)) {
        matched = "exact_token";
        break;
      }
      if (token.length >= 5) {
        const candidates = [labelSkeleton, ...labelTokens.map(skeleton)];
        if (candidates.some((candidate) => candidate === token || (candidate.includes(token) && isBrandPlusGlue(candidate, token)))) {
          matched = /[^a-z0-9-]/.test(label) ? "homograph" : "lookalike";
          break;
        }
        if (token.length >= 6) {
          const tolerance = token.length >= 8 ? 2 : 1;
          if (candidates.some((candidate) => candidate.length >= 5 && Math.abs(candidate.length - token.length) <= tolerance && levenshtein(candidate, token) <= tolerance)) {
            matched = "lookalike";
            break;
          }
        }
      }
    }
    if (!matched && brand.tokens.some((token) => subTokens.includes(token) || (token.length >= 5 && (u.subdomain ?? "").includes(token)))) matched = "subdomain";
    if (!matched && brand.tokens.some((token) => token.length >= 4 && pathTokens.includes(token))) matched = "path";
    if (matched) signals.push({ brand, kind: matched });
  }
  return signals;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Lexical URL rules. They never contact the target and run for every URL, including links inside messages. */
export function analyzeUrlLexical(u: UrlEvidence, context = ""): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const prefix = context ? `${context}: ` : "";
  const hostEvidence = { label: "Host", value: u.unicodeHostname === u.hostname ? u.hostname : `${u.unicodeHostname} (${u.hostname})` };

  if (u.hadUserinfo) {
    findings.push(draft({
      ruleId: "url.userinfo_deception", category: "phishing", severity: "high",
      title: `${prefix}Link hides its real destination before an @ sign`,
      description: `The link contains text before an "@" sign. Browsers ignore that part and connect to ${u.hostname}.`,
      impact: "Attackers use this to make a link look like it belongs to a trusted site.",
      recommendation: "Do not open the link. The real destination is the host after the @ sign.",
      evidence: [hostEvidence, { label: "Submitted", value: u.input }], confidence: "high",
    }));
  }

  if (u.isIp) {
    findings.push(draft({
      ruleId: "url.ip_literal", category: "phishing", severity: "medium",
      title: `${prefix}Link points to a raw IP address`,
      description: `The destination is ${u.hostname} instead of a domain name.`,
      impact: "Legitimate organisations rarely ask users to visit raw IP addresses; it avoids domain reputation checks.",
      recommendation: "Navigate to the organisation's site by typing its known domain instead.",
      evidence: [hostEvidence],
    }));
  }

  if (u.hostname.split(".").some((label) => label.startsWith("xn--"))) {
    const mixed = u.unicodeHostname.split(".").some((label) => scriptsIn(label).size > 1);
    findings.push(draft({
      ruleId: "url.punycode", category: "phishing", severity: mixed ? "high" : "low",
      title: mixed ? `${prefix}Domain mixes alphabets (homograph attack pattern)` : `${prefix}Internationalised domain name`,
      description: mixed
        ? `The domain ${u.unicodeHostname} combines characters from different alphabets. It is encoded as ${u.hostname}.`
        : `The domain uses non-ASCII characters and is encoded as ${u.hostname}.`,
      impact: mixed ? "Mixed-script domains can look identical to a trusted brand while being a different domain." : "Unicode domains are legitimate but can be used to imitate other names.",
      recommendation: "Compare the encoded form with the domain you expect before entering any information.",
      evidence: [hostEvidence], confidence: mixed ? "high" : "medium",
    }));
  }

  for (const signal of brandSignals(u)) {
    const official = signal.brand.domains.slice(0, 3).join(", ");
    const kindText: Record<BrandSignal["kind"], string> = {
      exact_token: `contains the brand name "${signal.brand.tokens[0]}"`,
      lookalike: `closely resembles "${signal.brand.tokens[0]}" (typosquatting)`,
      homograph: `imitates "${signal.brand.tokens[0]}" using lookalike characters`,
      subdomain: `places "${signal.brand.tokens[0]}" in a subdomain`,
      path: `mentions "${signal.brand.tokens[0]}" in the path`,
    };
    const severity = signal.kind === "path" ? "medium" : "high";
    findings.push(draft({
      ruleId: `url.brand_${signal.kind}`, category: "phishing", severity,
      title: `${prefix}Possible ${signal.brand.name} impersonation`,
      description: `The domain ${u.registrableDomain ?? u.hostname} ${kindText[signal.kind]}, but ${signal.brand.name} does not operate it. Official domains include ${official}.`,
      impact: `Users may believe they are on a ${signal.brand.name} site and disclose credentials or payment details.`,
      recommendation: `Open ${signal.brand.name} by typing ${signal.brand.domains[0]} yourself rather than following this link.`,
      evidence: [hostEvidence, { label: "Registrable domain", value: u.registrableDomain ?? u.hostname }, { label: "Claimed brand", value: signal.brand.name }],
      confidence: signal.kind === "path" ? "low" : "medium",
    }));
  }

  if (u.publicSuffix && HIGH_ABUSE_TLDS.has(u.publicSuffix.split(".").pop() ?? "")) {
    findings.push(draft({
      ruleId: "url.high_abuse_tld", category: "domain", severity: "low",
      title: `${prefix}Top-level domain frequently abused`,
      description: `.${u.publicSuffix} domains appear disproportionately in public phishing feeds.`,
      impact: "This is a weak signal; many legitimate sites use this TLD.",
      recommendation: "Treat as context only, combined with other findings.",
      evidence: [{ label: "TLD", value: `.${u.publicSuffix}` }], confidence: "low",
    }));
  }

  const subLabels = u.subdomain ? u.subdomain.split(".").filter(Boolean) : [];
  if (subLabels.length >= 4) {
    findings.push(draft({
      ruleId: "url.deep_subdomains", category: "phishing", severity: "medium",
      title: `${prefix}Unusually deep subdomain chain`,
      description: `The host has ${subLabels.length} subdomain levels before ${u.registrableDomain}.`,
      impact: "Long hostnames push the real domain out of view on mobile address bars.",
      recommendation: "Read the hostname from the right: the real owner is the registrable domain.",
      evidence: [hostEvidence],
    }));
  }

  const lowerUrl = decodeURIComponentSafe(`${u.hostname}${u.path}`).toLowerCase();
  const credentialHits = CREDENTIAL_WORDS.filter((word) => lowerUrl.includes(word));
  if (credentialHits.length >= 2 || (credentialHits.length >= 1 && findings.some((f) => f.ruleId.startsWith("url.brand_")))) {
    findings.push(draft({
      ruleId: "url.credential_keywords", category: "phishing", severity: "low",
      title: `${prefix}Account or verification wording in the link`,
      description: `The link contains ${credentialHits.map((w) => `"${w}"`).join(", ")}.`,
      impact: "Phishing links often use urgent account wording to look procedural.",
      recommendation: "Sign in only through the official app or a bookmarked address.",
      evidence: [{ label: "Keywords", value: credentialHits.join(", ") }], confidence: "low",
    }));
  }

  if (u.scheme === "http" && credentialHits.length >= 1) {
    findings.push(draft({
      ruleId: "url.cleartext_credential_path", category: "phishing", severity: "medium",
      title: `${prefix}Sign-in wording over unencrypted HTTP`,
      description: "The link uses plain HTTP while referring to account or sign-in actions.",
      impact: "Anything typed on this page can be read or altered in transit.",
      recommendation: "Never enter credentials on an HTTP page.",
      evidence: [{ label: "URL", value: u.normalized }],
    }));
  }

  try {
    const params = new URL(u.normalized).searchParams;
    for (const [key, value] of params) {
      if (!REDIRECT_PARAMS.has(key.toLowerCase())) continue;
      const nested = /^https?:\/\//i.test(value) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(value) ? normalizeTarget(value) : null;
      if (nested?.ok && nested.value.registrableDomain !== u.registrableDomain) {
        findings.push(draft({
          ruleId: "url.embedded_redirect", category: "redirect", severity: "medium",
          title: `${prefix}Link carries an embedded redirect to another domain`,
          description: `The "${key}" parameter sends visitors on to ${nested.value.hostname}.`,
          impact: "Open-redirect parameters let attackers borrow a trusted domain to reach a malicious one.",
          recommendation: `Investigate ${nested.value.hostname} directly before following this link.`,
          evidence: [{ label: "Parameter", value: key }, { label: "Embedded destination", value: nested.value.normalized }],
        }));
      }
    }
  } catch {
    // normalized URLs always parse; ignore defensively
  }

  if (URL_SHORTENERS.has(u.hostname) || (u.registrableDomain && URL_SHORTENERS.has(u.registrableDomain))) {
    findings.push(draft({
      ruleId: "url.shortener", category: "redirect", severity: "low",
      title: `${prefix}Shortened link hides the destination`,
      description: `${u.hostname} is a URL-shortening service.`,
      impact: "The final destination cannot be judged from the link text alone.",
      recommendation: "Review the redirect chain before opening the link.",
      evidence: [hostEvidence], confidence: "high",
    }));
  }

  const platform = sharedHostingPlatform(u.hostname);
  if (platform && findings.some((f) => f.ruleId.startsWith("url.brand_"))) {
    findings.push(draft({
      ruleId: "url.brand_on_shared_hosting", category: "phishing", severity: "medium",
      title: `${prefix}Brand content on a free hosting platform`,
      description: `The site is published on ${platform}, where anyone can create pages.`,
      impact: "Phishing kits are frequently hosted on free platforms to borrow their reputation and TLS certificates.",
      recommendation: "Official brand services are rarely hosted on shared platforms. Verify through the brand's own domain.",
      evidence: [{ label: "Platform", value: platform }],
    }));
  }

  if (u.port !== null && u.port !== 443 && u.port !== 80) {
    findings.push(draft({
      ruleId: "url.nonstandard_port", category: "domain", severity: "low",
      title: `${prefix}Non-standard port`,
      description: `The link connects to port ${u.port}.`,
      impact: "Public websites seldom use custom ports; it can indicate temporary infrastructure.",
      recommendation: "Treat as context alongside other findings.",
      evidence: [{ label: "Port", value: String(u.port) }], confidence: "low",
    }));
  }

  const label = registrableLabel(u);
  const digitCount = (label.match(/\d/g) ?? []).length;
  if (label.length >= 12 && !label.includes("-") && shannonEntropy(label) > 3.7 && (digitCount >= 3 || /[bcdfghjklmnpqrstvwxz]{5,}/.test(label))) {
    findings.push(draft({
      ruleId: "url.random_domain", category: "domain", severity: "low",
      title: `${prefix}Randomly generated-looking domain`,
      description: `"${label}" has high character randomness.`,
      impact: "Algorithmically generated domains are used for disposable phishing and malware infrastructure.",
      recommendation: "Treat as context alongside other findings.",
      evidence: [{ label: "Label", value: label }], confidence: "low",
    }));
  }

  if (u.normalized.length > 200) {
    findings.push(draft({
      ruleId: "url.long", category: "phishing", severity: "info",
      title: `${prefix}Very long link`,
      description: `The URL is ${u.normalized.length} characters long.`,
      impact: "Long URLs can hide the meaningful part; length alone is not suspicious.",
      recommendation: "Read the hostname rather than the whole link.",
      evidence: [{ label: "Length", value: String(u.normalized.length) }], confidence: "low",
    }));
  }

  return findings;
}
