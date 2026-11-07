import type { PageEvidence, RedirectHop, UrlEvidence } from "@veriq/contracts";
import { BRANDS, URL_SHORTENERS, findBrandMentions, isOfficialDomain } from "../brands";
import { draft, type FindingDraft } from "../finding";
import { AI_INSTRUCTION_PATTERN } from "../message";
import { registrableDomainOf } from "../url";

/** Redirect-chain rules. Hops were collected one at a time, each validated against the network policy. */
export function analyzeRedirects(u: UrlEvidence, hops: RedirectHop[]): FindingDraft[] {
  const findings: FindingDraft[] = [];
  if (!hops.length) return findings;
  const blocked = hops.find((hop) => hop.error?.startsWith("DESTINATION_BLOCKED"));
  if (blocked) {
    findings.push(draft({
      ruleId: "redirect.internal_target", category: "redirect", severity: "high",
      title: "Redirect attempted to reach a private or internal address",
      description: `A redirect pointed to ${blocked.host}, which resolves to a non-public network address. Veriq refused to follow it.`,
      impact: "Public websites have no reason to send visitors to internal addresses; this is typical of SSRF probes or hostile infrastructure.",
      recommendation: "Do not open this link from a corporate or home network.",
      evidence: [{ label: "Blocked hop", value: blocked.url }, { label: "Reason", value: blocked.error ?? "" }], confidence: "high",
    }));
  }

  const followed = hops.filter((hop) => hop.status !== null);
  const final = followed[followed.length - 1];
  const startDomain = u.registrableDomain ?? u.hostname;
  if (final && followed.length > 1) {
    const finalDomain = registrableDomainOf(final.host) ?? final.host;
    if (finalDomain !== startDomain) {
      const fromShortener = URL_SHORTENERS.has(u.hostname) || URL_SHORTENERS.has(startDomain);
      findings.push(draft({
        ruleId: "redirect.cross_domain", category: "redirect", severity: fromShortener ? "low" : "medium",
        title: fromShortener ? "Short link expands to a different domain" : "Redirects to an unrelated domain",
        description: `The link starts at ${startDomain} and ends at ${finalDomain} after ${followed.length - 1} redirect(s).`,
        impact: "What the user sees in the link is not where they end up.",
        recommendation: `Judge the destination (${finalDomain}), not the original link.`,
        evidence: followed.map((hop, index) => ({ label: `Hop ${index + 1}`, value: `${hop.status ?? "—"} ${hop.url}` })),
      }));
    }
    const downgrade = followed.some((hop, index) => index > 0 && hop.url.startsWith("http://") && followed[index - 1]?.url.startsWith("https://"));
    if (downgrade) {
      findings.push(draft({
        ruleId: "redirect.https_downgrade", category: "redirect", severity: "medium",
        title: "Redirect downgrades from HTTPS to HTTP",
        description: "At least one redirect moves the visitor from an encrypted to an unencrypted page.",
        impact: "Content after the downgrade can be intercepted or modified.",
        recommendation: "Do not enter information after an HTTPS-to-HTTP redirect.",
        evidence: followed.map((hop, index) => ({ label: `Hop ${index + 1}`, value: hop.url })),
      }));
    }
  }
  if (followed.length >= 5) {
    findings.push(draft({
      ruleId: "redirect.long_chain", category: "redirect", severity: "low",
      title: "Long redirect chain",
      description: `The link passes through ${followed.length - 1} redirects.`,
      impact: "Long chains are used to evade link scanners and rotate landing pages.",
      recommendation: "Treat as context alongside other findings.",
      evidence: [{ label: "Hops", value: String(followed.length - 1) }],
    }));
  }
  const limitHop = hops.find((hop) => hop.error === "REDIRECT_LIMIT");
  if (limitHop) {
    findings.push(draft({
      ruleId: "redirect.limit_reached", category: "redirect", severity: "low",
      title: "Redirect limit reached",
      description: "Veriq stopped following redirects after the safety limit.",
      impact: "The final destination is unknown; looping chains are used to frustrate analysis.",
      recommendation: "Do not rely on this link.",
      evidence: [{ label: "Last hop", value: limitHop.url }],
    }));
  }
  return findings;
}

/** Inert page-content rules over bounded, script-free HTML extraction. */
export function analyzePage(u: UrlEvidence, page: PageEvidence): FindingDraft[] {
  const findings: FindingDraft[] = [];
  let finalHost = u.hostname;
  try {
    finalHost = new URL(page.finalUrl).hostname;
  } catch {
    // keep submitted host
  }
  const finalDomain = registrableDomainOf(finalHost) ?? finalHost;
  const finalIsHttps = page.finalUrl.startsWith("https://");
  const claimed = findBrandMentions(`${page.title ?? ""} ${page.textExcerpt.slice(0, 1500)}`).filter((brand) => !isOfficialDomain(brand, finalDomain, finalHost));
  const credentialForms = page.forms.filter((form) => form.hasPassword || form.hasOtpField || form.hasPaymentField);

  if (credentialForms.length && claimed.length) {
    const brand = claimed[0]!;
    findings.push(draft({
      ruleId: "page.brand_identity_mismatch", category: "phishing", severity: "high",
      title: `Page presents itself as ${brand.name} and asks for sensitive data`,
      description: `The page mentions ${brand.name} and contains a ${describeForm(credentialForms[0]!)} form, but it is served from ${finalDomain}, which ${brand.name} does not operate.`,
      impact: "This is the core pattern of credential-harvesting phishing.",
      recommendation: `Close the page. Use ${brand.domains[0]} directly if you need to reach ${brand.name}.`,
      evidence: [{ label: "Page title", value: page.title ?? "(none)" }, { label: "Served from", value: finalHost }, { label: "Official domains", value: brand.domains.slice(0, 3).join(", ") }],
      confidence: "high",
    }));
  } else if (claimed.length && page.title && findBrandMentions(page.title).some((brand) => claimed.includes(brand))) {
    const brand = findBrandMentions(page.title).find((item) => claimed.includes(item))!;
    findings.push(draft({
      ruleId: "page.brand_in_title", category: "phishing", severity: "low",
      title: `Page title references ${brand.name}`,
      description: `The title "${page.title}" names ${brand.name}, but the page is on ${finalDomain}.`,
      impact: "Third-party pages mention brands legitimately; this is only meaningful together with other findings.",
      recommendation: "Check that you expected to be on this domain.",
      evidence: [{ label: "Page title", value: page.title }], confidence: "low",
    }));
  }

  for (const form of credentialForms) {
    const actionDomain = form.actionHost ? (registrableDomainOf(form.actionHost) ?? form.actionHost) : finalDomain;
    if (actionDomain !== finalDomain) {
      findings.push(draft({
        ruleId: "page.cross_origin_credential_form", category: "phishing", severity: "high",
        title: "Sensitive form submits to a different domain",
        description: `A ${describeForm(form)} form on ${finalDomain} sends its data to ${actionDomain}.`,
        impact: "Credentials or payment details entered here are delivered to a third party.",
        recommendation: "Do not submit this form.",
        evidence: [{ label: "Form action", value: form.action }], confidence: "high",
      }));
    }
    if (!finalIsHttps || form.action.startsWith("http://")) {
      findings.push(draft({
        ruleId: "page.cleartext_credential_form", category: "phishing", severity: "high",
        title: "Sensitive form over unencrypted HTTP",
        description: `A ${describeForm(form)} form is served or submitted without HTTPS.`,
        impact: "Anything entered can be read or modified on the network.",
        recommendation: "Never enter credentials or payment data on this page.",
        evidence: [{ label: "Form action", value: form.action }], confidence: "high",
      }));
    }
  }

  const borrowed = BRANDS.filter((brand) => !isOfficialDomain(brand, finalDomain, finalHost) && page.resourceDomains.some((domain) => isOfficialDomain(brand, registrableDomainOf(domain), domain)) && claimed.includes(brand));
  for (const brand of borrowed.slice(0, 2)) {
    findings.push(draft({
      ruleId: "page.borrowed_brand_assets", category: "phishing", severity: "medium",
      title: `Page loads ${brand.name} assets from ${brand.name}'s servers`,
      description: `The page claims to be ${brand.name} and hot-links images or scripts from ${brand.name}'s own domains while being hosted elsewhere.`,
      impact: "Phishing kits copy genuine logos and styles to look authentic.",
      recommendation: `Verify you are on ${brand.domains[0]} before signing in.`,
      evidence: [{ label: "Resource domains", value: page.resourceDomains.slice(0, 6).join(", ") }],
    }));
  }

  if (page.metaRefresh) {
    const target = /url=(.+)$/i.exec(page.metaRefresh)?.[1]?.replace(/^['"]|['"]$/g, "");
    let targetDomain: string | null = null;
    try {
      targetDomain = target ? registrableDomainOf(new URL(target, page.finalUrl).hostname) : null;
    } catch {
      targetDomain = null;
    }
    if (targetDomain && targetDomain !== finalDomain) {
      findings.push(draft({
        ruleId: "page.meta_refresh_offsite", category: "redirect", severity: "medium",
        title: "Page silently forwards to another domain",
        description: `A meta-refresh tag forwards visitors to ${targetDomain}. Veriq did not follow it.`,
        impact: "Client-side redirects are used to evade server-side link scanners.",
        recommendation: `Investigate ${targetDomain} separately.`,
        evidence: [{ label: "Meta refresh", value: page.metaRefresh }],
      }));
    }
  }
  const injection = [...`${page.title ?? ""} ${page.textExcerpt}`.matchAll(AI_INSTRUCTION_PATTERN)].map((match) => match[0]);
  if (injection.length) {
    findings.push(draft({
      ruleId: "page.ai_manipulation", category: "phishing", severity: "medium",
      title: "Page contains instructions aimed at AI scanners",
      description: `The page text includes: ${[...new Set(injection)].slice(0, 3).map((text) => `"${text}"`).join(", ")}.`,
      impact: "Attempting to steer automated analysis is an evasion technique. Veriq treats page text as data, so it cannot change the result.",
      recommendation: "Treat the page with additional suspicion.",
      evidence: [...new Set(injection)].slice(0, 3).map((text) => ({ label: "Matched text", value: text })),
      confidence: "medium",
    }));
  }
  if (page.scriptRedirectHint) {
    findings.push(draft({
      ruleId: "page.script_redirect", category: "redirect", severity: "low",
      title: "Page contains script-driven navigation",
      description: "Inline script changes the page location. Veriq does not execute scripts, so the destination was not observed.",
      impact: "The real destination may differ from what was inspected.",
      recommendation: "Treat this report as partial for the final destination.",
      evidence: [], confidence: "low",
    }));
  }
  return findings;
}

function describeForm(form: PageEvidence["forms"][number]): string {
  if (form.hasPassword) return "password";
  if (form.hasOtpField) return "one-time-code";
  return "payment-card";
}

const EOL_PATTERNS: Array<{ pattern: RegExp; product: string; note: string }> = [
  { pattern: /php\/(5\.|7\.|8\.[01]\b)/i, product: "PHP", note: "PHP versions before 8.2 no longer receive security fixes." },
  { pattern: /apache\/2\.(0|2)\./i, product: "Apache httpd", note: "Apache 2.0 and 2.2 reached end of life in 2017 or earlier." },
  { pattern: /nginx\/1\.(\d|1[0-7])\./i, product: "nginx", note: "nginx releases before 1.18 are unsupported." },
  { pattern: /microsoft-iis\/(5|6|7)\./i, product: "IIS", note: "IIS 7.5 and earlier shipped with unsupported Windows versions." },
  { pattern: /openssl\/(0\.|1\.0|1\.1)/i, product: "OpenSSL", note: "OpenSSL 1.1.1 and earlier no longer receive public security fixes." },
];

/** Passive security-configuration review. Configuration findings never decide phishing on their own. */
export function analyzeSecurityHeaders(page: PageEvidence): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const headers = page.headers;
  const https = page.finalUrl.startsWith("https://");
  const config = (input: Omit<Parameters<typeof draft>[0], "category">) => findings.push(draft({ ...input, category: "configuration" }));

  if (!https) {
    config({
      ruleId: "config.no_https", severity: "medium",
      title: "Site is served without HTTPS",
      description: "The final page was delivered over plain HTTP.",
      impact: "Visitors' traffic can be read and modified in transit.",
      recommendation: "Site owner: serve all pages over HTTPS and redirect HTTP to HTTPS.",
      evidence: [{ label: "Final URL", value: page.finalUrl }], confidence: "high",
    });
  }
  if (https && !headers["strict-transport-security"]) {
    config({
      ruleId: "config.missing_hsts", severity: "low",
      title: "Missing Strict-Transport-Security header",
      description: "The HTTPS response does not set HSTS.",
      impact: "First visits can be downgraded to HTTP by a network attacker.",
      recommendation: "Site owner: add `Strict-Transport-Security: max-age=31536000; includeSubDomains`.",
    });
  }
  const csp = headers["content-security-policy"];
  if (!csp) {
    config({
      ruleId: "config.missing_csp", severity: "low",
      title: "Missing Content-Security-Policy",
      description: "No CSP header was returned.",
      impact: "Cross-site scripting flaws are easier to exploit without a CSP.",
      recommendation: "Site owner: define a restrictive Content-Security-Policy.",
    });
  }
  if (!headers["x-frame-options"] && !(csp && /frame-ancestors/i.test(csp))) {
    config({
      ruleId: "config.missing_frame_protection", severity: "low",
      title: "Page can be embedded by other sites",
      description: "Neither X-Frame-Options nor CSP frame-ancestors is set.",
      impact: "Enables clickjacking, where a hostile page overlays invisible controls.",
      recommendation: "Site owner: set `frame-ancestors 'self'` in CSP or `X-Frame-Options: DENY`.",
    });
  }
  if ((headers["x-content-type-options"] ?? "").toLowerCase() !== "nosniff") {
    config({
      ruleId: "config.missing_nosniff", severity: "info",
      title: "Missing X-Content-Type-Options: nosniff",
      description: "The browser may guess content types.",
      impact: "Minor hardening gap.",
      recommendation: "Site owner: add `X-Content-Type-Options: nosniff`.",
    });
  }
  if (!headers["referrer-policy"]) {
    config({
      ruleId: "config.missing_referrer_policy", severity: "info",
      title: "No Referrer-Policy",
      description: "The site relies on the browser default referrer policy.",
      impact: "Full URLs may leak to third parties on older browsers.",
      recommendation: "Site owner: set `Referrer-Policy: strict-origin-when-cross-origin`.",
    });
  }
  const insecureCookies = page.setCookies.filter((cookie) => https && !cookie.secure);
  if (insecureCookies.length) {
    config({
      ruleId: "config.cookie_not_secure", severity: "low",
      title: "Cookies set without the Secure flag",
      description: `${insecureCookies.length} cookie(s) can be sent over plain HTTP.`,
      impact: "Session cookies may leak on unencrypted connections.",
      recommendation: "Site owner: mark cookies `Secure; HttpOnly; SameSite=Lax` where possible.",
      evidence: [{ label: "Cookies", value: insecureCookies.map((cookie) => cookie.name).slice(0, 5).join(", ") }],
    });
  }
  if (page.mixedContent.active > 0 || page.mixedContent.passive > 0) {
    config({
      ruleId: "config.mixed_content", severity: page.mixedContent.active > 0 ? "medium" : "low",
      title: "HTTPS page references HTTP resources",
      description: `${page.mixedContent.active} active (script/frame/style) and ${page.mixedContent.passive} passive (image/media) resources use http://.`,
      impact: "Active mixed content can be replaced by a network attacker to take over the page.",
      recommendation: "Site owner: load every resource over HTTPS.",
      evidence: [{ label: "Active", value: String(page.mixedContent.active) }, { label: "Passive", value: String(page.mixedContent.passive) }],
    });
  }
  const banner = [headers["server"], headers["x-powered-by"], page.generator].filter(Boolean).join(" ");
  if (banner) {
    const eol = EOL_PATTERNS.find((entry) => entry.pattern.test(banner));
    if (eol) {
      config({
        ruleId: "config.eol_software", severity: "medium",
        title: `Reports an end-of-life ${eol.product} version`,
        description: `The server advertises "${banner}". ${eol.note}`,
        impact: "Unsupported software accumulates unpatched vulnerabilities. Version banners can be inaccurate or back-patched by vendors.",
        recommendation: "Site owner: upgrade to a supported release and stop advertising versions.",
        evidence: [{ label: "Banner", value: banner }], confidence: "low",
      });
    } else if (/\d/.test(banner)) {
      config({
        ruleId: "config.version_disclosure", severity: "info",
        title: "Server discloses software versions",
        description: `The response advertises "${banner}".`,
        impact: "Helps attackers match known vulnerabilities.",
        recommendation: "Site owner: suppress version banners.",
        evidence: [{ label: "Banner", value: banner }],
      });
    }
  }
  return findings;
}
