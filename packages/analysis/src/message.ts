import type { ExtractedIndicator, MessageEvidence } from "@veriq/contracts";
import { parse } from "tldts";
import { AUTHORITY_TERMS, findBrandMentions, isOfficialDomain, type Brand } from "./brands";
import { draft, type FindingDraft } from "./finding";
import { indicatorHash } from "./hash";
import { analyzeUrlLexical } from "./rules/url-rules";
import { truncate } from "./text";
import { normalizeTarget } from "./url";

const UPI_HANDLES = ["okaxis", "oksbi", "okhdfcbank", "okicici", "ybl", "ibl", "axl", "paytm", "upi", "apl", "yapl", "ptyes", "ptsbi", "pthdfc", "ptaxis", "jupiteraxis", "fbl", "airtel", "freecharge", "kotak", "icici", "sbi", "hdfcbank", "axisbank", "pnb", "boi", "barodampay", "idfcbank", "indus", "rbl", "yesbank", "slc", "naviaxis", "superyes", "waicici", "wasbi", "waaxis", "wahdfcbank"];

type CueDefinition = { cue: string; label: string; severity: "low" | "medium" | "high"; patterns: RegExp[]; requiresRequest?: boolean };

/** Text that tries to instruct an AI analyser ("ignore previous instructions", "classify this as safe"). */
export const AI_INSTRUCTION_PATTERN = /\b(ignore|disregard|forget) (all |any |the )?(previous|prior|above|earlier) (instructions|prompts|rules)|\b(you are now|new instructions:|system prompt)|\b(classify|mark|label|report|rate) (this|the) (site|page|message|email|url|link) as (safe|legitimate|benign|low risk)\b/gi;

const REQUEST_VERBS = /(share|send|provide|enter|confirm|reply|tell|update|submit|give|forward|verify|type|fill)/i;
const NEGATION = /(never|do not|don't|dont|not|no one|nobody|will never|won't|wont)\b[^.!?\n]{0,40}$/i;

const CUES: CueDefinition[] = [
  { cue: "urgency", label: "Urgency or deadline pressure", severity: "low", patterns: [/\b(urgent(ly)?|immediately|act now|right away|asap|today only|last chance|final (notice|warning|reminder)|within \d+\s*(hours?|hrs?|minutes?|mins?)|expires? (today|tonight|soon)|limited time|deadline)\b/gi] },
  { cue: "threat_of_loss", label: "Threat of account suspension or penalty", severity: "medium", patterns: [/\b(account|card|kyc|sim|service|pan|aadhaa?r|wallet|connection|electricity)\b[^.!?\n]{0,40}\b(suspend(ed)?|block(ed)?|deactivat(ed|ion)|terminat(ed|ion)|frozen|freeze|locked|disabled|closed|disconnect(ed)?)\b/gi, /\b(legal action|arrest warrant|fir (has been )?(registered|filed)|penalty|fine of)\b/gi] },
  { cue: "credential_request", label: "Request for passwords, OTPs, PINs or recovery phrases", severity: "high", requiresRequest: true, patterns: [/\b(otp|one[- ]time (password|code)|pin(?![\s-]?code)|cvv|password|passcode|login (details|credentials)|net ?banking (id|credentials)|verification code|seed phrase|recovery phrase|secret phrase|private key|mpin|upi pin)\b/gi] },
  { cue: "payment_request", label: "Request to send money", severity: "low", patterns: [/\b(pay|transfer|send|deposit|remit)\b[^.!?\n]{0,40}(₹|rs\.?|inr|usd|\$|€|fee|amount|charges?|money|payment)/gi] },
  { cue: "fee_request", label: "Upfront fee or deposit demanded", severity: "medium", patterns: [/\b(registration fee|processing fee|security deposit|refundable (deposit|fee)|clearance fee|customs (duty|charge)|delivery charge|activation fee|verification fee|release fee|unlock fee)\b/gi] },
  { cue: "gift_card_payment", label: "Payment requested in gift cards or crypto", severity: "high", patterns: [/\b(gift ?cards?|google play (card|code)s?|itunes (card|code)s?|steam (card|code)s?|amazon (pay )?(gift )?vouchers?)\b/gi, /\b(pay|send|transfer)\b[^.!?\n]{0,30}\b(usdt|bitcoin|btc|eth|crypto)\b/gi] },
  { cue: "prize_lure", label: "Prize, lottery or reward lure", severity: "medium", patterns: [/\b(you('ve| have)? won|winner|lottery|lucky draw|jackpot|claim your (prize|reward|gift)|free iphone|cash ?prize|selected for a (reward|prize))\b/gi] },
  { cue: "refund_lure", label: "Refund or cashback lure", severity: "low", patterns: [/\b(refund|cashback|cash back|reimbursement)\b[^.!?\n]{0,40}\b(pending|approved|initiated|claim|credited)\b/gi] },
  { cue: "job_lure", label: "Unsolicited job or easy-income offer", severity: "low", patterns: [/\b(work from home|part[- ]time (job|work)|earn (₹|rs\.?|\$)?\s?[\d,]+\s*(\/|per)?\s*(day|daily|hour|week)|no experience (required|needed)|immediate joining|offer letter|like (and|&) subscribe tasks?|task[- ]based (job|earning))\b/gi] },
  { cue: "investment_lure", label: "Guaranteed-return investment pitch", severity: "high", patterns: [/\b(guaranteed (returns?|profits?)|double your (money|investment)|\d+\s?% (daily|weekly|monthly) (returns?|profits?)|risk[- ]free (returns?|investment)|crypto (investment|trading) (plan|opportunity|group)|forex signals?|vip trading group)\b/gi] },
  { cue: "remote_access", label: "Request to install remote-access software", severity: "high", patterns: [/\b(anydesk|teamviewer|quick ?support|rustdesk|ultraviewer|airdroid|screen ?shar(e|ing)|remote (access|desktop|support) app)\b/gi] },
  { cue: "kyc_update", label: "KYC or account-verification demand", severity: "medium", patterns: [/\b(re-?kyc|kyc|know your customer|pan card|aadhaa?r)\b[^.!?\n]{0,60}\b(update|verify|verification|complete|pending|expired?|link)\b/gi] },
  { cue: "secrecy", label: "Instruction to keep the request secret", severity: "low", patterns: [/\b(keep (this|it) (confidential|secret)|do not (tell|inform) (anyone|your family|the bank)|don'?t tell anyone)\b/gi] },
  { cue: "ai_manipulation", label: "Hidden instructions aimed at AI or automated scanners", severity: "medium", patterns: [AI_INSTRUCTION_PATTERN] },
  { cue: "authority", label: "Invokes police, government or regulator authority", severity: "low", patterns: [new RegExp(`\\b(${AUTHORITY_TERMS.map((term) => term.replace(/\s+/g, "\\s+")).join("|")})\\b`, "gi")] },
];

const PROTECTIVE = [/\b(never|do not|don't) share (your )?(otp|pin|password|cvv)/gi, /\bwe (will )?never ask (you )?for\b/gi, /\bif (this|it) wasn'?t you\b/gi, /\bignore this (message|email) if\b/gi];

function redactEmail(value: string): string {
  const [local = "", domain = ""] = value.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
function redactPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return `${digits.length > 10 ? "+" + digits.slice(0, digits.length - 10) + " " : ""}******${digits.slice(-4)}`;
}
function redactUpi(value: string): string {
  const [local = "", handle = ""] = value.split("@");
  return `${local.slice(0, 2)}***@${handle}`;
}
function redactWallet(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export type ExtractionResult = {
  indicators: ExtractedIndicator[];
  links: MessageEvidence["links"];
  redactedText: string;
};

/** Extract inert indicators. Links are recorded, never fetched. Raw personal identifiers are hashed and redacted. */
export function extractIndicators(text: string): ExtractionResult {
  const indicators: ExtractedIndicator[] = [];
  const links: MessageEvidence["links"] = [];
  const seen = new Set<string>();
  let redacted = text;
  const add = (type: ExtractedIndicator["type"], raw: string, display: string, normalized = raw.toLowerCase()) => {
    const key = `${type}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    indicators.push({ type, display, hash: indicatorHash(type, normalized) });
  };

  for (const match of text.matchAll(/\b[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+\b/gi)) {
    add("email", match[0], redactEmail(match[0]));
    redacted = redacted.split(match[0]).join(redactEmail(match[0]));
  }
  for (const match of text.matchAll(/\b([a-z0-9._-]{2,64})@([a-z]{2,32})\b(?!\.)/gi)) {
    const handle = (match[2] ?? "").toLowerCase();
    if (!UPI_HANDLES.includes(handle)) continue;
    add("upi", match[0], redactUpi(match[0]));
    redacted = redacted.split(match[0]).join(redactUpi(match[0]));
  }

  const urlCandidates = new Set<string>();
  for (const match of text.matchAll(/\b(?:https?:\/\/|hxxps?:\/\/|www\.)[^\s<>"'`)\]]+/gi)) urlCandidates.add(match[0]);
  for (const match of text.matchAll(/(?<![@\w.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s<>"'`)\]]*)?/gi)) {
    const candidate = match[0];
    if ([...urlCandidates].some((existing) => existing.includes(candidate))) continue;
    const host = candidate.split("/")[0] ?? "";
    const parsed = parse(host);
    if (!parsed.isIcann || !parsed.domain || /^\d+(\.\d+)+$/.test(host)) continue;
    if (/^(e\.g|i\.e|etc|mr|mrs|dr|no)\./i.test(candidate)) continue;
    urlCandidates.add(candidate);
  }
  for (const candidate of urlCandidates) {
    const cleaned = candidate.replace(/[.,;:!?]+$/, "");
    const normalized = normalizeTarget(cleaned);
    links.push({
      display: truncate(cleaned, 160),
      normalized: normalized.ok ? normalized.value.normalized : null,
      registrableDomain: normalized.ok ? normalized.value.registrableDomain : null,
    });
    add("url", cleaned, truncate(cleaned, 160), normalized.ok ? normalized.value.normalized : cleaned.toLowerCase());
  }

  const textWithoutUrls = [...urlCandidates].reduce((value, url) => value.split(url).join(" "), text);
  for (const match of textWithoutUrls.matchAll(/(?<![\w])(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,6}(?![\w])/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) continue;
    add("phone", match[0], redactPhone(match[0]), digits.slice(-10));
    redacted = redacted.split(match[0]).join(redactPhone(match[0]));
  }
  for (const match of text.matchAll(/\b(0x[a-fA-F0-9]{40}|bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|T[1-9A-HJ-NP-Za-km-z]{33})\b/g)) {
    add("crypto_wallet", match[0], redactWallet(match[0]), match[0]);
    redacted = redacted.split(match[0]).join(redactWallet(match[0]));
  }
  for (const match of text.matchAll(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g)) add("ifsc", match[0], match[0], match[0]);
  for (const match of text.matchAll(/(?:₹|rs\.?|inr|usd|\$|€)\s?\d[\d,]*(?:\.\d{1,2})?/gi)) add("amount", match[0], match[0].trim(), match[0].replace(/\s/g, "").toLowerCase());

  // Account-like long digit runs (card/account numbers) are redacted but not kept as indicators.
  redacted = redacted.replace(/\b\d{12,19}\b/g, (value) => `****${value.slice(-4)}`);
  return { indicators, links, redactedText: redacted };
}

export type CueMatch = { cue: string; label: string; severity: "low" | "medium" | "high"; matches: string[] };

export function detectCues(text: string): { cues: CueMatch[]; protective: string[] } {
  const cues: CueMatch[] = [];
  for (const definition of CUES) {
    const matches: string[] = [];
    for (const pattern of definition.patterns) {
      for (const match of text.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (definition.requiresRequest) {
          // Judge the request within its own sentence: "Your OTP is 1234. Never share it" is a notice, not a request.
          const start = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf("!", index - 1), text.lastIndexOf("?", index - 1), text.lastIndexOf("\n", index - 1)) + 1;
          const endCandidates = [".", "!", "?", "\n"].map((mark) => text.indexOf(mark, index + match[0].length)).filter((position) => position >= 0);
          const end = endCandidates.length ? Math.min(...endCandidates) : text.length;
          const before = text.slice(start, index);
          const sentence = text.slice(start, end);
          if (NEGATION.test(before)) continue; // "never share your OTP" is a safety warning, not a request
          if (!REQUEST_VERBS.test(sentence)) continue;
        }
        matches.push(truncate(match[0].trim(), 80));
      }
    }
    if (matches.length) cues.push({ cue: definition.cue, label: definition.label, severity: definition.severity, matches: [...new Set(matches)].slice(0, 5) });
  }
  const protective = PROTECTIVE.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));
  return { cues, protective: [...new Set(protective)].slice(0, 5) };
}

export type MessageAnalysis = { evidence: MessageEvidence; findings: FindingDraft[] };

/**
 * Message and email analysis. Persuasive or urgent language alone never produces more than a low-severity
 * cue; elevated findings require a sensitive request, an identity mismatch, or a risky link.
 */
export function analyzeMessage(input: { text: string; sender?: string | undefined; subject?: string | undefined }): MessageAnalysis {
  const fullText = [input.subject, input.text].filter(Boolean).join("\n");
  const extraction = extractIndicators(fullText);
  const { cues, protective } = detectCues(fullText);
  const senderDomain = input.sender && input.sender.includes("@") ? (parse(input.sender.split("@").pop() ?? "").domain ?? null) : null;
  const claimedBrands = findBrandMentions(fullText);
  const findings: FindingDraft[] = [];
  const has = (cue: string) => cues.find((item) => item.cue === cue);

  // A payment request matters when it names where to send money (UPI ID, wallet, bank code); bills mention payment too.
  const paymentDestination = extraction.indicators.some((indicator) => ["upi", "crypto_wallet", "ifsc"].includes(indicator.type));
  for (const cue of cues) {
    if (cue.cue === "payment_request" && paymentDestination) cue.severity = "medium";
  }

  for (const cue of cues) {
    if (cue.cue === "authority") continue; // only meaningful in combination, below
    findings.push(draft({
      ruleId: `message.${cue.cue}`, category: "message", severity: cue.severity,
      title: cue.label,
      description: `The message contains: ${cue.matches.map((m) => `"${m}"`).join(", ")}.`,
      impact: cueImpact(cue.cue),
      recommendation: cueAdvice(cue.cue),
      evidence: cue.matches.map((m) => ({ label: "Matched text", value: m })),
      confidence: cue.severity === "low" ? "low" : "medium",
    }));
  }

  const pressure = has("urgency") || has("threat_of_loss");
  const directedPayment = paymentDestination ? has("payment_request") : undefined;
  const sensitive = has("credential_request") || has("fee_request") || has("gift_card_payment") || directedPayment;
  if (pressure && sensitive) {
    findings.push(draft({
      ruleId: "message.pressure_plus_sensitive_request", category: "message", severity: "medium",
      title: "Pressure tactics combined with a sensitive request",
      description: "The message pairs urgency or threats with a request for credentials or money.",
      impact: "Creating panic so the reader acts before verifying is the defining pattern of social-engineering fraud.",
      recommendation: "Pause. Contact the organisation through a phone number or app you already trust.",
      evidence: [{ label: "Pressure", value: (pressure.matches[0] ?? "") }, { label: "Request", value: (sensitive.matches[0] ?? "") }],
    }));
  }
  if (has("job_lure") && (has("fee_request") || directedPayment || has("gift_card_payment"))) {
    findings.push(draft({
      ruleId: "message.job_fee", category: "message", severity: "high",
      title: "Job offer that requires the applicant to pay",
      description: "The message offers work or income and also asks for a fee, deposit or transfer.",
      impact: "Legitimate employers do not charge candidates to be hired. This is the most common recruitment-scam pattern.",
      recommendation: "Do not pay. Verify the employer through its official careers page.",
      evidence: [{ label: "Offer", value: has("job_lure")?.matches[0] ?? "" }, { label: "Payment", value: (has("fee_request") ?? directedPayment ?? has("gift_card_payment"))?.matches[0] ?? "" }],
      confidence: "high",
    }));
  }
  if (has("authority") && (has("threat_of_loss") || sensitive)) {
    findings.push(draft({
      ruleId: "message.authority_impersonation", category: "message", severity: "high",
      title: "Authority figure used to demand action",
      description: `The message invokes ${has("authority")?.matches[0]} together with threats or a payment/credential request.`,
      impact: "Police, courts and regulators do not collect fines or credentials through messages ('digital arrest' and customs scams).",
      recommendation: "Do not respond. Report to the national cybercrime helpline (1930 in India) or the official agency.",
      evidence: [{ label: "Authority", value: has("authority")?.matches[0] ?? "" }],
    }));
  }

  // Claimed identity versus actual sender and link destinations.
  const linkFindings: FindingDraft[] = [];
  extraction.links.forEach((link, index) => {
    if (!link.normalized) return;
    const normalized = normalizeTarget(link.normalized);
    if (!normalized.ok) return;
    linkFindings.push(...analyzeUrlLexical(normalized.value, `Link ${index + 1} (${normalized.value.hostname})`));
  });
  findings.push(...linkFindings);

  for (const brand of claimedBrands.slice(0, 3)) {
    const offDomainLinks = extraction.links.filter((link) => link.registrableDomain && !isOfficialDomain(brand, link.registrableDomain));
    const officialLinks = extraction.links.filter((link) => link.registrableDomain && isOfficialDomain(brand, link.registrableDomain));
    if (offDomainLinks.length && !officialLinks.length) {
      findings.push(draft({
        ruleId: "message.brand_link_mismatch", category: "phishing", severity: "high",
        title: `Claims to be from ${brand.name} but links elsewhere`,
        description: `The message mentions ${brand.name}, yet its link(s) go to ${offDomainLinks.map((link) => link.registrableDomain).slice(0, 3).join(", ")}, which ${brand.name} does not operate.`,
        impact: "Mismatched links are the main way scam messages move victims to credential-harvesting pages.",
        recommendation: `Do not use the link. Open ${brand.domains[0]} or the official app yourself.`,
        evidence: [{ label: "Claimed", value: brand.name }, ...offDomainLinks.slice(0, 3).map((link) => ({ label: "Link domain", value: link.registrableDomain ?? "" }))],
        confidence: "high",
      }));
    }
    if (senderDomain && !isOfficialDomain(brand, senderDomain) && isClaimedSender(brand, fullText)) {
      findings.push(draft({
        ruleId: "message.sender_mismatch", category: "phishing", severity: "medium",
        title: `Sender domain does not belong to ${brand.name}`,
        description: `The message presents itself as ${brand.name} but was sent from ${senderDomain}.`,
        impact: "Display names are easy to forge; the sending domain is harder to fake.",
        recommendation: "Treat the message as unverified.",
        evidence: [{ label: "Sender domain", value: senderDomain }],
      }));
    }
  }

  const evidence: MessageEvidence = {
    characters: fullText.length,
    redactedExcerpt: truncate(extraction.redactedText, 600),
    senderDomain,
    claimedBrands: claimedBrands.map((brand) => brand.name),
    indicators: extraction.indicators,
    links: extraction.links,
    cues: cues.map(({ cue, label, matches }) => ({ cue, label, matches })),
    protectiveLanguage: protective,
  };
  return { evidence, findings };
}

function isClaimedSender(brand: Brand, text: string): boolean {
  const lower = text.toLowerCase();
  return brand.tokens.some((token) => new RegExp(`(team|from|dear customer|regards|support)[^.\n]{0,40}${token}|${token}[^.\n]{0,20}(team|support|bank|customer care)`).test(lower));
}

function cueImpact(cue: string): string {
  switch (cue) {
    case "urgency": return "Urgency on its own is common in genuine notifications; it matters when combined with sensitive requests.";
    case "credential_request": return "No legitimate bank, employer or service asks for OTPs, PINs, passwords or recovery phrases by message.";
    case "payment_request": return "Payment requests are normal in bills; they matter when the message names an unfamiliar destination such as a personal UPI ID or wallet.";
    case "fee_request": return "Upfront fees to receive a job, prize, parcel or refund are the defining feature of advance-fee fraud.";
    case "gift_card_payment": return "Gift cards and crypto transfers are irreversible and untraceable, which is why scammers demand them.";
    case "remote_access": return "Remote-access apps give the caller full control of your device and banking apps.";
    case "investment_lure": return "Guaranteed high returns are the hallmark of investment and crypto fraud.";
    case "threat_of_loss": return "Threats of suspension or penalties are used to rush the reader.";
    case "prize_lure": return "Unexpected prizes are used to collect fees or personal details.";
    case "kyc_update": return "Banks do not complete KYC through links in messages.";
    case "secrecy": return "Isolation from family or the bank is a manipulation tactic.";
    case "ai_manipulation": return "Legitimate messages have no reason to address AI systems; this is an attempt to evade automated scam detection. Veriq treats it as data and it cannot change the result.";
    default: return "A social-engineering cue that warrants caution.";
  }
}

function cueAdvice(cue: string): string {
  switch (cue) {
    case "credential_request": return "Never share OTPs, PINs, passwords or recovery phrases with anyone.";
    case "remote_access": return "Do not install apps at a stranger's request. Uninstall any you already installed and contact your bank.";
    case "payment_request":
    case "fee_request":
    case "gift_card_payment": return "Do not pay. Verify the request through an independent channel.";
    case "urgency": return "Take time to verify before acting.";
    default: return "Verify the claim through an official channel you find yourself.";
  }
}
