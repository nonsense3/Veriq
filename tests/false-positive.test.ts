import { describe, expect, it } from "vitest";
import { assessUrl, normalizeTarget } from "../packages/analysis/src/index";
import { page, tls, urlChecks, NOT_LISTED } from "./fixtures/evidence";
import type { PageEvidence } from "../packages/contracts/src/index";
function assess(target: string, details: Partial<PageEvidence>) {
  const parsed = normalizeTarget(target);
  if (!parsed.ok) throw Error(parsed.message);
  const url = parsed.value;
  return assessUrl({ reportId: "00000000-0000-4000-8000-000000000001", createdAt: "2026-11-08T08:00:00Z", collection: {
    url, page: page(url.normalized, details), tls: tls(url.hostname), intel: NOT_LISTED, checks: urlChecks(),
  } });
}
const password = (host: string) => ({ action: `https://${host}/session`, actionHost: host, method: "post", hasPassword: true, hasPaymentField: false, hasOtpField: false });
describe("legitimate website context versus impersonation", () => {
  it.each([['google.com','Google'],['github.com','GitHub'],['example.com','Example workspace']])('does not call %s phishing for mentioning other brands beside its own login', (host, title) => {
    const report = assess(`https://${host}/`, { title, textExcerpt: "Sign in with Google. Integrates with Microsoft, Apple and GitHub.", forms: [password(host)], resourceDomains: ['gstatic.com','githubassets.com'], scriptRedirectHint: true });
    expect(report.risk.classification).toBe('low_risk');
    expect(report.findings.some(f => f.ruleId === 'page.brand_identity_mismatch')).toBe(false);
  });
  it('keeps a copied brand credential page on an unrelated domain suspicious', () => {
    const report = assess('https://account-check.example.com/', { title: 'Google Account Login', textExcerpt: 'Google Sign in', forms: [password('collector.example.net')], resourceDomains: ['gstatic.com'] });
    expect(report.risk.classification).toBe('high_risk');
    expect(report.findings.some(f => f.ruleId === 'page.brand_identity_mismatch')).toBe(true);
  });
  it('still flags an official-domain password form sending credentials to an unrelated host', () => {
    const report = assess('https://github.com/', { title: 'GitHub', forms: [password('collector.example.net')] });
    expect(report.findings.some(f => f.ruleId === 'page.cross_origin_credential_form')).toBe(true);
    expect(report.risk.classification).toBe('suspicious');
  });
  it('does not treat Google same-operator account navigation as unrelated', () => {
    const report = assess('https://google.com/', { title: 'Google', forms: [password('accounts.google.com')] });
    expect(report.risk.classification).toBe('low_risk');
  });
});

