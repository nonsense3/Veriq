/** Compact animated glyphs for the six-views and false-alarm cards. Decorative only. */

export function LookalikeArt() {
  return (
    <svg aria-hidden="true" className="glyph glyph-lookalike" viewBox="0 0 120 48">
      <rect height="18" rx="9" width="104" x="8" y="4" />
      <text x="20" y="17">paypal.com</text>
      <rect className="bad-frame" height="18" rx="9" width="104" x="8" y="26" />
      <text x="20" y="39">payp<tspan className="swap">a1</tspan>.com</text>
    </svg>
  );
}

export function CertificateArt() {
  return (
    <svg aria-hidden="true" className="glyph glyph-cert" viewBox="0 0 120 48">
      <rect height="22" rx="6" width="26" x="6" y="13" />
      <rect height="22" rx="6" width="26" x="47" y="13" />
      <rect className="leaf" height="22" rx="6" width="26" x="88" y="13" />
      <path className="chain" d="M32 24h15M73 24h15" />
    </svg>
  );
}

export function PageArt() {
  return (
    <svg aria-hidden="true" className="glyph glyph-page" viewBox="0 0 120 48">
      <rect height="40" rx="6" width="56" x="6" y="4" />
      <rect className="field" height="7" rx="3.5" width="40" x="14" y="14" />
      <rect className="field" height="7" rx="3.5" width="40" x="14" y="26" />
      <path className="leak" d="M62 30 C 80 30, 84 18, 104 18" />
      <circle className="dest" cx="108" cy="18" r="5" />
    </svg>
  );
}

export function MessageArt() {
  return (
    <svg aria-hidden="true" className="glyph glyph-message" viewBox="0 0 120 48">
      <path d="M8 8h80a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H30l-10 8v-8h-6a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6Z" />
      <rect className="otp" height="6" rx="3" width="30" x="20" y="19" />
      <rect className="otp" height="6" rx="3" width="20" x="54" y="19" />
      <circle className="alert" cx="104" cy="12" r="7" />
    </svg>
  );
}

export function FeedArt() {
  return (
    <svg aria-hidden="true" className="glyph glyph-feed" viewBox="0 0 120 48">
      {[0, 1, 2, 3].map((index) => (
        <rect className={index === 2 ? "row hit" : "row"} height="6" key={index} rx="3" style={{ animationDelay: `${index * 0.35}s` }} width={70 + (index % 2) * 20} x="8" y={6 + index * 10} />
      ))}
    </svg>
  );
}

export function CorrelationArt() {
  return (
    <svg aria-hidden="true" className="glyph glyph-corr" viewBox="0 0 120 48">
      <path className="edge" d="M18 34 L48 14 L78 34 L104 12 M48 14 L104 12" />
      <circle cx="18" cy="34" r="5" />
      <circle className="hub" cx="48" cy="14" r="6" />
      <circle cx="78" cy="34" r="5" />
      <circle className="hub" cx="104" cy="12" r="6" />
    </svg>
  );
}

export const VIEW_ART = [LookalikeArt, CertificateArt, PageArt, MessageArt, FeedArt, CorrelationArt];
