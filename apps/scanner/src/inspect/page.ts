import { findBrandMentions, registrableDomainOf, truncate } from "@veriq/analysis";
import type { FormEvidence, PageEvidence } from "@veriq/contracts";
import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { parse, type HTMLElement } from "node-html-parser";

const SECURITY_HEADERS = [
  "strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy",
  "permissions-policy", "cross-origin-opener-policy", "server", "x-powered-by", "content-type",
];

function absolute(value: string | undefined, base: string): URL | null {
  if (!value) return null;
  try {
    return new URL(value.trim(), base);
  } catch {
    return null;
  }
}

function parseSetCookies(headers: IncomingHttpHeaders): PageEvidence["setCookies"] {
  const raw = headers["set-cookie"] ?? [];
  return raw.slice(0, 20).map((cookie) => {
    const [pair = "", ...attributes] = cookie.split(";");
    const lower = attributes.map((attribute) => attribute.trim().toLowerCase());
    return {
      name: pair.split("=")[0]?.trim().slice(0, 64) ?? "",
      secure: lower.includes("secure"),
      httpOnly: lower.includes("httponly"),
      sameSite: lower.find((attribute) => attribute.startsWith("samesite="))?.split("=")[1] ?? null,
    };
  });
}

const OTP_FIELD = /(otp|one-?time|verification.?code|passcode|2fa|totp|mpin|upi.?pin)/i;
const PAYMENT_FIELD = /(cc-?number|card.?number|cardnum|cvv|cvc|cc-?csc|expiry|cc-?exp)/i;

function describeInputs(scope: HTMLElement): Pick<FormEvidence, "hasPassword" | "hasOtpField" | "hasPaymentField"> {
  const inputs = scope.querySelectorAll("input");
  const describe = (input: HTMLElement) => `${input.getAttribute("name") ?? ""} ${input.getAttribute("id") ?? ""} ${input.getAttribute("autocomplete") ?? ""} ${input.getAttribute("placeholder") ?? ""}`;
  return {
    hasPassword: inputs.some((input) => (input.getAttribute("type") ?? "").toLowerCase() === "password"),
    hasOtpField: inputs.some((input) => OTP_FIELD.test(describe(input))),
    hasPaymentField: inputs.some((input) => PAYMENT_FIELD.test(describe(input))),
  };
}

/** Parse bounded HTML into inert evidence. No script is executed and no sub-resource is requested. */
export function extractPage(input: { finalUrl: string; status: number; headers: IncomingHttpHeaders; body: Buffer | null; bodyBytes: number }): PageEvidence {
  const headers: Record<string, string> = {};
  for (const name of SECURITY_HEADERS) {
    const value = input.headers[name];
    if (value !== undefined) headers[name] = truncate(Array.isArray(value) ? value.join(", ") : String(value), 400);
  }
  const base: PageEvidence = {
    finalUrl: input.finalUrl,
    status: input.status,
    contentType: typeof input.headers["content-type"] === "string" ? input.headers["content-type"] : null,
    bodyBytes: input.bodyBytes,
    bodySha256: input.body ? createHash("sha256").update(input.body).digest("hex") : null,
    title: null,
    textExcerpt: "",
    headers,
    setCookies: parseSetCookies(input.headers),
    forms: [],
    externalDomains: [],
    resourceDomains: [],
    mixedContent: { active: 0, passive: 0 },
    metaRefresh: null,
    scriptRedirectHint: false,
    generator: null,
    brandMentions: [],
  };
  if (!input.body || !/html/i.test(base.contentType ?? "html")) return base;

  const html = input.body.toString("utf8");
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: false, pre: true } });
  const pageUrl = new URL(input.finalUrl);
  const pageDomain = registrableDomainOf(pageUrl.hostname) ?? pageUrl.hostname;
  const isHttps = pageUrl.protocol === "https:";

  const inlineScripts = root.querySelectorAll("script:not([src])").map((script) => script.text).join("\n").slice(0, 200_000);
  base.scriptRedirectHint = /(window\.|document\.|top\.)?location(\.href)?\s*=(?!=)|location\.(replace|assign)\s*\(/.test(inlineScripts);
  base.title = truncate(root.querySelector("title")?.text.replace(/\s+/g, " ").trim() ?? "", 200) || null;
  base.metaRefresh = root.querySelector('meta[http-equiv="refresh" i]')?.getAttribute("content") ?? root.querySelectorAll("meta").find((meta) => (meta.getAttribute("http-equiv") ?? "").toLowerCase() === "refresh")?.getAttribute("content") ?? null;
  base.generator = root.querySelectorAll("meta").find((meta) => (meta.getAttribute("name") ?? "").toLowerCase() === "generator")?.getAttribute("content")?.slice(0, 120) ?? null;

  const forms: FormEvidence[] = root.querySelectorAll("form").slice(0, 20).map((form) => {
    const action = absolute(form.getAttribute("action") || input.finalUrl, input.finalUrl);
    return {
      action: action?.toString() ?? input.finalUrl,
      actionHost: action?.hostname ?? null,
      method: (form.getAttribute("method") ?? "get").toLowerCase(),
      ...describeInputs(form),
    };
  });
  const loose = describeInputs(root);
  if ((loose.hasPassword || loose.hasOtpField || loose.hasPaymentField) && !forms.some((form) => form.hasPassword || form.hasOtpField || form.hasPaymentField)) {
    forms.push({ action: input.finalUrl, actionHost: pageUrl.hostname, method: "script", ...loose });
  }
  base.forms = forms;

  const external = new Set<string>();
  for (const anchor of root.querySelectorAll("a[href]").slice(0, 500)) {
    const target = absolute(anchor.getAttribute("href"), input.finalUrl);
    if (!target || !/^https?:$/.test(target.protocol)) continue;
    const domain = registrableDomainOf(target.hostname) ?? target.hostname;
    if (domain !== pageDomain) external.add(domain);
  }
  base.externalDomains = [...external].slice(0, 30);

  const resources = new Set<string>();
  const active = [
    ...root.querySelectorAll("script[src]").map((node) => node.getAttribute("src")),
    ...root.querySelectorAll("iframe[src]").map((node) => node.getAttribute("src")),
    ...root.querySelectorAll("link[href]").filter((node) => /stylesheet|icon|preload/i.test(node.getAttribute("rel") ?? "")).map((node) => node.getAttribute("href")),
  ];
  const passive = [
    ...root.querySelectorAll("img[src]").map((node) => node.getAttribute("src")),
    ...root.querySelectorAll("source[src], video[src], audio[src]").map((node) => node.getAttribute("src")),
  ];
  for (const [list, kind] of [[active, "active"], [passive, "passive"]] as const) {
    for (const value of list.slice(0, 400)) {
      const target = absolute(value, input.finalUrl);
      if (!target || !/^https?:$/.test(target.protocol)) continue;
      if (isHttps && target.protocol === "http:") base.mixedContent[kind] += 1;
      if (target.hostname !== pageUrl.hostname) resources.add(target.hostname);
    }
  }
  base.resourceDomains = [...resources].slice(0, 40);

  for (const node of root.querySelectorAll("script, style, noscript, svg, template")) node.remove();
  const text = (root.querySelector("body") ?? root).structuredText.replace(/\s+/g, " ").trim();
  base.textExcerpt = truncate(text, 1500);
  base.brandMentions = findBrandMentions(`${base.title ?? ""} ${text.slice(0, 3000)}`).map((brand) => brand.name);
  return base;
}
