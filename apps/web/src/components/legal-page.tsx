import Link from "next/link";
import { SiteFooter, SiteHeader } from "./site-header";

export type LegalSection = { title: string; paragraphs: string[] };

export function LegalPage({ title, intro, sections }: { title: string; intro: string; sections: LegalSection[] }) {
  const contact = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return <>
    <SiteHeader />
    <main className="page container" id="main-content">
      <article className="legal-document">
        <header><p className="eyebrow">Axiom / Veriq · Prototype notice · Updated 7 November 2026</p><h1>{title}</h1><p>{intro}</p></header>
        <nav aria-label={`${title} contents`}><ol>{sections.map((section, index) => <li key={section.title}><a href={`#section-${index + 1}`}>{section.title}</a></li>)}</ol></nav>
        {sections.map((section, index) => <section id={`section-${index + 1}`} key={section.title}><h2>{index + 1}. {section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
        <section id="contact"><h2>Contact Axiom</h2>{contact ? <p>For privacy, deletion, corrections or support, contact <a href={`mailto:${contact}`}>{contact}</a>. Do not email passwords, OTPs or private keys.</p> : <p>Contact the Axiom team running your demonstration. For non-sensitive support you can also use the <a href="https://github.com/nonsense3/Veriq/issues" rel="noreferrer" target="_blank">Veriq issue tracker</a>. Issues are public: never post private reports, identifiers or credentials. A dedicated privacy email has not yet been supplied and should be configured before public launch.</p>}</section>
        <p className="legal-crosslinks"><Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link> · <Link href="/dashboard">Investigate</Link></p>
      </article>
    </main>
    <SiteFooter />
  </>;
}
