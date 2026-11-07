/**
 * Brands frequently impersonated in phishing and scam campaigns, with the registrable domains they
 * officially operate. The list is deliberately small and reviewed by hand; it is a detection aid,
 * not an allowlist. A domain that is not listed here is not assumed to be malicious.
 */
export type Brand = {
  name: string;
  category: "bank" | "payments" | "government" | "technology" | "commerce" | "logistics" | "social" | "crypto" | "education";
  /** Distinctive lowercase tokens. Tokens shorter than 5 characters are only matched exactly. */
  tokens: string[];
  domains: string[];
};

export const BRANDS: Brand[] = [
  { name: "PayPal", category: "payments", tokens: ["paypal"], domains: ["paypal.com", "paypal.me", "paypalobjects.com"] },
  { name: "Google", category: "technology", tokens: ["google", "gmail"], domains: ["google.com", "gmail.com", "google.co.in", "googleusercontent.com", "gstatic.com", "googleapis.com", "googlevideo.com", "google-analytics.com", "googletagmanager.com", "googlesyndication.com", "doubleclick.net", "youtube.com", "goo.gl", "g.co", "android.com"] },
  { name: "Microsoft", category: "technology", tokens: ["microsoft", "outlook", "office365", "onedrive", "hotmail", "sharepoint"], domains: ["microsoft.com", "live.com", "outlook.com", "office.com", "office365.com", "microsoftonline.com", "hotmail.com", "sharepoint.com", "onedrive.com", "msn.com", "azure.com", "windows.net", "bing.com"] },
  { name: "Apple", category: "technology", tokens: ["apple", "icloud", "itunes"], domains: ["apple.com", "icloud.com", "apple.co", "itunes.com", "me.com"] },
  { name: "Amazon", category: "commerce", tokens: ["amazon"], domains: ["amazon.com", "amazon.in", "amazon.co.uk", "amazon.de", "amazonaws.com", "amazon.jobs", "media-amazon.com", "amazon.dev"] },
  { name: "Meta / Facebook", category: "social", tokens: ["facebook", "instagram", "whatsapp", "messenger"], domains: ["facebook.com", "fb.com", "instagram.com", "whatsapp.com", "whatsapp.net", "messenger.com", "meta.com", "fbcdn.net", "cdninstagram.com"] },
  { name: "Netflix", category: "commerce", tokens: ["netflix"], domains: ["netflix.com", "nflxext.com"] },
  { name: "LinkedIn", category: "social", tokens: ["linkedin"], domains: ["linkedin.com", "licdn.com", "lnkd.in"] },
  { name: "GitHub", category: "technology", tokens: ["github"], domains: ["github.com", "github.io", "githubusercontent.com", "githubassets.com"] },
  { name: "Dropbox", category: "technology", tokens: ["dropbox"], domains: ["dropbox.com", "dropboxusercontent.com"] },
  { name: "DHL", category: "logistics", tokens: ["dhl"], domains: ["dhl.com", "dhl.de", "dhl.co.in"] },
  { name: "FedEx", category: "logistics", tokens: ["fedex"], domains: ["fedex.com"] },
  { name: "UPS", category: "logistics", tokens: ["ups"], domains: ["ups.com"] },
  { name: "India Post", category: "logistics", tokens: ["indiapost"], domains: ["indiapost.gov.in"] },
  { name: "State Bank of India", category: "bank", tokens: ["sbi", "onlinesbi", "yonosbi"], domains: ["sbi", "onlinesbi.sbi", "sbi.co.in", "onlinesbi.com", "sbicard.com"] },
  { name: "HDFC Bank", category: "bank", tokens: ["hdfc", "hdfcbank"], domains: ["hdfcbank.com", "hdfc.com", "hdfcbank.net"] },
  { name: "ICICI Bank", category: "bank", tokens: ["icici", "icicibank"], domains: ["icicibank.com", "icici.bank.in", "icicidirect.com"] },
  { name: "Axis Bank", category: "bank", tokens: ["axisbank"], domains: ["axisbank.com", "axis.bank.in"] },
  { name: "Kotak Mahindra Bank", category: "bank", tokens: ["kotak"], domains: ["kotak.com", "kotak.bank.in"] },
  { name: "Punjab National Bank", category: "bank", tokens: ["pnbindia", "pnb"], domains: ["pnbindia.in", "pnb.bank.in"] },
  { name: "Paytm", category: "payments", tokens: ["paytm"], domains: ["paytm.com", "paytm.in", "paytmbank.com"] },
  { name: "PhonePe", category: "payments", tokens: ["phonepe"], domains: ["phonepe.com"] },
  { name: "NPCI / UPI", category: "payments", tokens: ["npci", "bhim"], domains: ["npci.org.in", "bhimupi.org.in"] },
  { name: "Income Tax Department (India)", category: "government", tokens: ["incometax", "efiling"], domains: ["incometax.gov.in", "incometaxindia.gov.in"] },
  { name: "GST Portal (India)", category: "government", tokens: ["gstportal", "gst"], domains: ["gst.gov.in"] },
  { name: "UIDAI / Aadhaar", category: "government", tokens: ["uidai", "aadhaar", "aadhar"], domains: ["uidai.gov.in", "myaadhaar.uidai.gov.in"] },
  { name: "EPFO", category: "government", tokens: ["epfo", "epfindia"], domains: ["epfindia.gov.in", "epfo.gov.in"] },
  { name: "IRCTC", category: "commerce", tokens: ["irctc"], domains: ["irctc.co.in"] },
  { name: "Flipkart", category: "commerce", tokens: ["flipkart"], domains: ["flipkart.com"] },
  { name: "Binance", category: "crypto", tokens: ["binance"], domains: ["binance.com"] },
  { name: "Coinbase", category: "crypto", tokens: ["coinbase"], domains: ["coinbase.com"] },
  { name: "MetaMask", category: "crypto", tokens: ["metamask"], domains: ["metamask.io"] },
  { name: "Roblox", category: "social", tokens: ["roblox"], domains: ["roblox.com", "rbxcdn.com"] },
  { name: "Steam", category: "commerce", tokens: ["steampowered", "steamcommunity"], domains: ["steampowered.com", "steamcommunity.com", "steamstatic.com"] },
  { name: "Yahoo", category: "technology", tokens: ["yahoo"], domains: ["yahoo.com", "yahoo.co.in", "yimg.com"] },
  { name: "X / Twitter", category: "social", tokens: ["twitter"], domains: ["twitter.com", "x.com", "t.co", "twimg.com"] },
  { name: "Telegram", category: "social", tokens: ["telegram"], domains: ["telegram.org", "t.me", "telegram.me"] },
  { name: "Chase", category: "bank", tokens: ["chase", "jpmorgan"], domains: ["chase.com", "jpmorgan.com", "jpmorganchase.com"] },
  { name: "Wells Fargo", category: "bank", tokens: ["wellsfargo"], domains: ["wellsfargo.com"] },
  { name: "Bank of America", category: "bank", tokens: ["bankofamerica"], domains: ["bankofamerica.com", "bofa.com"] },
  { name: "HSBC", category: "bank", tokens: ["hsbc"], domains: ["hsbc.com", "hsbc.co.in", "hsbc.co.uk"] },
  { name: "Adobe", category: "technology", tokens: ["adobe"], domains: ["adobe.com", "adobelogin.com", "typekit.net"] },
  { name: "DocuSign", category: "technology", tokens: ["docusign"], domains: ["docusign.com", "docusign.net"] },
];

/** Public authorities commonly invoked in scam messages. Mentions are cues, not proof. */
export const AUTHORITY_TERMS = [
  "police", "cyber cell", "cyber crime", "customs", "income tax department", "reserve bank", "rbi", "trai",
  "cbi", "enforcement directorate", "narcotics", "court", "fedex customs", "electricity board", "telecom department",
];

export function isOfficialDomain(brand: Brand, registrableDomain: string | null, hostname?: string): boolean {
  if (!registrableDomain && !hostname) return false;
  const candidates = [registrableDomain, hostname].filter((value): value is string => Boolean(value));
  return brand.domains.some((domain) => candidates.some((candidate) => candidate === domain || candidate.endsWith(`.${domain}`)));
}

export function brandByName(name: string): Brand | undefined {
  return BRANDS.find((brand) => brand.name === name);
}

/** Brands named in free text (page titles, messages). Word-boundary matching keeps `ups` out of `groups`. */
export function findBrandMentions(text: string): Brand[] {
  const lower = text.toLowerCase();
  const found: Brand[] = [];
  for (const brand of BRANDS) {
    const names = [brand.name.toLowerCase().split(" / ")[0] ?? "", ...brand.tokens];
    if (names.some((token) => token.length >= 3 && new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}([^a-z0-9]|$)`).test(lower))) {
      found.push(brand);
    }
  }
  return found;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const URL_SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly", "rb.gy", "s.id", "shorturl.at", "ow.ly", "buff.ly", "tiny.cc",
  "rebrand.ly", "t.ly", "v.gd", "shorte.st", "bl.ink", "lnkd.in", "s4w.in", "qrco.de", "short.gy", "urlz.fr", "clck.ru",
]);

/** Platforms where anyone can publish content under a shared parent domain. */
export const SHARED_HOSTING_SUFFIXES = [
  "000webhostapp.com", "weebly.com", "wixsite.com", "netlify.app", "vercel.app", "pages.dev", "workers.dev", "github.io",
  "firebaseapp.com", "web.app", "glitch.me", "ngrok-free.app", "ngrok.io", "trycloudflare.com", "duckdns.org", "blogspot.com",
  "sites.google.com", "godaddysites.com", "webflow.io", "framer.website", "replit.app", "onrender.com", "herokuapp.com",
  "azurewebsites.net", "appspot.com", "r2.dev", "ipfs.io", "dweb.link", "square.site", "mystrikingly.com", "carrd.co",
];

export function sharedHostingPlatform(hostname: string): string | null {
  return SHARED_HOSTING_SUFFIXES.find((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)) ?? null;
}

/** TLDs with consistently high abuse rates in public phishing feeds. A weak signal on its own. */
export const HIGH_ABUSE_TLDS = new Set([
  "zip", "mov", "xyz", "top", "tk", "ml", "ga", "cf", "gq", "cyou", "icu", "click", "link", "rest", "monster", "buzz", "sbs", "cfd",
  "lol", "quest", "bond", "shop", "online", "site", "live", "support", "help", "work", "fit", "country", "kim", "loan", "win", "bid",
]);
