"use client";

import { ArrowDown, ArrowRight, Blocks, FileCheck2, Fingerprint, Lock } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EvidenceGraph } from "./evidence-graph";
import { CyberScene } from "./gl/cyber-scene";
import { InvestigationComposer } from "./investigation-composer";
import { AnalyseArt, AssessArt, InvestigateArt, SubmitArt, VerifyArt } from "./journey-art";
import { LiveStream } from "./live-stream";
import { RiskBadge } from "./risk";
import { SiteFooter, SiteHeader } from "./site-header";
import { FeedArt, LookalikeArt, MessageArt, VIEW_ART } from "./view-art";

const JOURNEY = [
  { title: "Submit", body: "A link, a domain or a message.", art: SubmitArt },
  { title: "Investigate", body: "DNS, redirects, certificate, feeds.", art: InvestigateArt },
  { title: "Analyse", body: "Rules find it. AI explains it.", art: AnalyseArt },
  { title: "Assess", body: "One of five clear risk levels.", art: AssessArt },
  { title: "Verify", body: "A record no one can alter.", art: VerifyArt },
];

const VIEWS = [
  { title: "Link & domain", body: "Lookalikes and homographs" },
  { title: "Certificate", body: "Chain, CT logs, bad CAs" },
  { title: "Page identity", body: "Brand claims, form targets" },
  { title: "Messages", body: "OTP and fee scams" },
  { title: "Intelligence", body: "Live phishing feeds" },
  { title: "Correlation", body: "Linked campaigns" },
];

const CASES = [
  { title: "Valid padlock, fake bank", body: "Encryption isn't identity.", classification: "high_risk" as const, label: "High Risk", art: LookalikeArt },
  { title: "Urgent, but genuine", body: "A deadline alone isn't fraud.", classification: "low_risk" as const, label: "Low Risk", art: MessageArt },
  { title: "Listed phishing page", body: "A live feed confirms it.", classification: "confirmed_malicious" as const, label: "Confirmed Malicious", art: FeedArt },
];

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { y: 40 }} transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }} viewport={{ once: true, margin: "-40px 0px" }} whileInView={{ y: 0 }}>
      {children}
    </motion.div>
  );
}

/**
 * Headline that lights up word by word as it scrolls into view. Words start dimmed, never invisible.
 *
 * The viewport margin must stay vertical-only ("-60px 0px"). A single value shrinks the observer
 * box horizontally too, and a short word near the left page edge (the "A" in "A padlock proves")
 * then never intersects it on a narrow screen, so it stayed dimmed for good.
 */
function WordReveal({ text, id }: { text: string; id?: string }) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  return (
    <h2 className="statement" id={id}>
      {words.map((word, index) => (
        <motion.span
          initial={reduce ? false : { opacity: 0.18, y: 14 }}
          key={`${word}-${index}`}
          style={{ display: "inline-block", marginRight: "0.24em" }}
          transition={{ duration: 0.6, delay: index * 0.045, ease: [0.16, 1, 0.3, 1] }}
          viewport={{ once: true, margin: "-60px 0px" }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          {word}
        </motion.span>
      ))}
    </h2>
  );
}

/** A browser address bar being inspected: the padlock passes, the identity check fails. */
function AddressDemo() {
  return (
    <div aria-label="Example: a valid padlock on a site that is not the bank" className="addr-demo" role="img">
      <div className="addr-bar">
        <Lock aria-hidden="true" size={14} />
        <span>https://sbi-kyc-update.in/verify</span>
        <i className="addr-scan" />
      </div>
      <ul className="addr-checks">
        <li className="ok" style={{ animationDelay: "0.4s" }}><span>Connection encrypted</span><b>Pass</b></li>
        <li className="bad" style={{ animationDelay: "1.1s" }}><span>Owned by the bank</span><b>Fail</b></li>
        <li className="bad" style={{ animationDelay: "1.8s" }}><span>Asks for your OTP</span><b>Fail</b></li>
      </ul>
      <div className="addr-verdict" style={{ animationDelay: "2.5s" }}>
        <RiskBadge classification="high_risk" label="High Risk" />
      </div>
    </div>
  );
}

export function LandingExperience() {
  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <section aria-labelledby="hero-title" className="hero container">
          <div className="hero-intro">
            <div><p className="intro-eyebrow">A little doubt. A clearer picture.</p><h1 className="hero-title" id="hero-title">Verify before you <em>trust.</em></h1></div>
            <div className="hero-intro-copy"><p>Behind every link is a story. Veriq connects the signals so you can see what deserves a second look.</p><a className="intro-link" href="#veriq-intro">Meet Veriq <ArrowDown aria-hidden="true" size={17} /></a></div>
          </div>
          <div className="stage hero-stage landing-hero-stage">
            <div aria-hidden="true" className="signal-horizon"><span /><span /><span /></div>
            <div aria-hidden="true" className="hero-art"><CyberScene align="center" shapes={["torus-knot", "shield", "nexus"]} /></div>
            <div className="stage-top">
              <span>Live evidence graph · hover a node</span>
              <span>Passive inspection</span>
            </div>
            <div className="hero-graph-slot">
              <EvidenceGraph />
            </div>
            <InvestigationComposer />
          </div>
          <div className="intro-caption">
            <span>01 / Look closer</span><a href="#veriq-intro">The story behind the signals <ArrowDown aria-hidden="true" size={14} /></a><span>Built by Axiom</span>
          </div>
        </section>

        <section aria-labelledby="statement" className="section container veriq-intro" id="veriq-intro">
          <Reveal className="intro-heading"><p className="intro-eyebrow">Less guesswork. More perspective.</p><p>A familiar logo. A convincing message. A perfectly valid padlock. Trust takes more than appearances.</p></Reveal>
          <div className="statement-grid">
            <div>
              <WordReveal id="statement" text="A padlock proves encryption. Not who you're talking to." />
              <Reveal delay={0.15}>
                <Link className="pill pill-dark" href="/dashboard" style={{ marginTop: 32 }}>Start investigating <span className="dot" /></Link>
              </Reveal>
            </div>
            <Reveal delay={0.1}>
              <AddressDemo />
            </Reveal>
          </div>
        </section>

        <section aria-labelledby="journey-title" className="section container" id="method">
          <div className="section-head">
            <h2 id="journey-title">Five steps. One answer.</h2>
          </div>
          <div className="journey">
            {JOURNEY.map((step, index) => {
              const Art = step.art;
              return (
                <Reveal delay={index * 0.07} key={step.title}>
                  <article className="journey-card">
                    <div className="journey-top">
                      <span className="num">0{index + 1}</span>
                    </div>
                    <div className="journey-art"><Art /></div>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                    </div>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="views-title" className="section container">
          <div className="stage views-stage">
            <h2 id="views-title">Six views of one link.</h2>
            <div aria-hidden="true" className="views-art">
              <CyberScene align="center" mode="cycle" orbits={false} shapes={["helix", "fingerprint", "nexus"]} threat={0.06} />
            </div>
            <div className="views-grid">
              {VIEWS.map((view, index) => {
                const Art = VIEW_ART[index]!;
                return (
                  <article className="glass view-card" key={view.title}>
                    <div className="view-art"><Art /></div>
                    <div>
                      <h3>{view.title}</h3>
                      <p>{view.body}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section aria-labelledby="cases-title" className="section container">
          <div className="section-head">
            <h2 id="cases-title">Built to avoid false alarms.</h2>
          </div>
          <div className="cases">
            {CASES.map((item, index) => (
              <Reveal delay={index * 0.06} key={item.title}>
                <article className="case">
                  <div className="case-art"><item.art /></div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <RiskBadge classification={item.classification} label={item.label} />
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        <section aria-labelledby="stream-title" className="section container">
          <LiveStream />
        </section>

        <section aria-labelledby="integrity-title" className="section container">
          <div className="integrity">
            <div className="integrity-copy">
              <h2 id="integrity-title">Fingerprints on-chain. Evidence stays private.</h2>
              <p>Only a sealed fingerprint goes on the public ledger. Anyone can later check the report wasn't changed.</p>
              <div className="actions">
                <Link className="pill pill-signal" href="/verify">Verify a report <ArrowRight size={15} /></Link>
                <Link className="pill pill-ghost" href="/repository">Repository</Link>
              </div>
            </div>
            <div className="stage proof-stage">
              <div aria-hidden="true" className="proof-art"><CyberScene align="center" orbits={false} shapes={["blocks", "shield"]} size={0.9} threat={0} /></div>
              <ol className="proof-flow">
                {[
                  { icon: FileCheck2, title: "Report sealed", detail: "Salted fingerprint" },
                  { icon: Blocks, title: "Anchored on-chain", detail: "No personal data" },
                  { icon: Fingerprint, title: "Verified by anyone", detail: "Edits break the match" },
                ].map((step) => (
                  <li className="proof-step glass" key={step.title}>
                    <span className="icon"><step.icon size={18} /></span>
                    <span><strong>{step.title}</strong><span>{step.detail}</span></span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="section container">
          <div className="stage cta-stage">
            <div aria-hidden="true" className="cta-art"><CyberScene align="center" shapes={["key", "torus-knot", "lock"]} threat={0} /></div>
            <h2 id="cta-title">Check the link before you click.</h2>
            <Link aria-label="Start an investigation" className="cta-button" href="/dashboard">
              <span>Investigate</span>
              <ArrowRight size={34} strokeWidth={1.5} />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
