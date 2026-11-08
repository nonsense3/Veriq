import Link from "next/link";
import { SiteFooter, SiteHeader } from "./site-header";

export type LegalSection = { title: string; paragraphs: string[]; links?: { label: string; href: string }[] };

export function LegalPage({ title, intro, sections }: { title: string; intro: string; sections: LegalSection[] }) {
  const contact = "support.veriq@axiomjisu.tech";
  return <>
    <SiteHeader />
    <main className="page container" id="main-content">
      <article className="legal-document">
        <header><p className="eyebrow">Axiom / Veriq · Prototype notice · Updated 9 November 2026</p><h1>{title}</h1><p>{intro}</p></header>
        <nav aria-label={`${title} contents`}><ol>{sections.map((section, index) => <li key={section.title}><a href={`#section-${index + 1}`}>{section.title}</a></li>)}</ol></nav>
        {sections.map((section, index) => <section id={`section-${index + 1}`} key={section.title}><h2>{index + 1}. {section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.links && <ul>{section.links.map((link) => <li key={link.href}><a href={link.href} rel="noreferrer" target="_blank">{link.label}</a></li>)}</ul>}</section>)}
        <section id="contact"><h2>Contact Axiom</h2><p>For privacy, deletion, corrections or support, contact <a href={`mailto:${contact}`}>{contact}</a>. Include the relevant report ID when requesting help, but do not email passwords, OTPs, private keys, recovery phrases or confidential report content.</p></section>
        <p className="legal-crosslinks"><Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link> · <Link href="/dashboard">Investigate</Link></p>
      </article>
    </main>
    <SiteFooter />
  </>;
}
