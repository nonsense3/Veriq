"use client";

import { investigationRequestSchema, MAX_MESSAGE_LENGTH, type PublicError } from "@veriq/contracts";
import { ArrowRight, Globe2 } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { remember } from "@/lib/history";
import { SAMPLE_MESSAGES, SAMPLE_URLS } from "@/lib/samples";
import { ApiNotice, FieldError } from "./notice";
import { navigateWithTransition } from "./route-transition";
import { SlidingTabs } from "./sliding-tabs";

type Mode = "url" | "message";

const URL_STAGES = ["Validate", "DNS & redirects", "TLS & page", "Intelligence", "Assess"];
const MESSAGE_STAGES = ["Redact", "Extract", "Detect cues", "Check links", "Assess"];

export function InvestigationComposer({ initialTarget = "", parentReportId = "", showSamples = true }: { initialTarget?: string; parentReportId?: string; showSamples?: boolean }) {
  const [mode, setMode] = useState<Mode>("url");
  const [target, setTarget] = useState(initialTarget);
  const [text, setText] = useState("");
  const [sender, setSender] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [apiError, setApiError] = useState<PublicError | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);
  useEffect(() => {
    if (initialTarget) {
      setTarget(initialTarget);
      setMode("url");
    }
  }, [initialTarget]);

  function switchMode(next: Mode) {
    setMode(next);
    setFieldError("");
    setApiError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const revision = parentReportId && target === initialTarget ? { parentReportId } : {};
    const body = mode === "url" ? { kind: "url" as const, target, ...revision } : { kind: "message" as const, text, ...(sender.trim() ? { sender: sender.trim() } : {}) };
    const parsed = investigationRequestSchema.safeParse(body);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Check your input.");
      return;
    }
    setFieldError("");
    setApiError(null);
    setBusy(true);
    setStage(0);
    // Stage labels describe the work in order; they are not a progress percentage.
    timer.current = setInterval(() => setStage((value) => Math.min(value + 1, 4)), mode === "url" ? 2200 : 700);
    try {
      const response = await api.investigate(parsed.data);
      remember(response);
      navigateWithTransition(`/report?id=${response.report.reportId}`);
    } catch (caught) {
      setApiError(caught instanceof ApiError ? caught.error : { code: "UNEXPECTED_ERROR", title: "Investigation failed", message: "Your input is still here. Try again.", retryable: true, correlationId: "client" });
      setBusy(false);
    } finally {
      if (timer.current) clearInterval(timer.current);
    }
  }

  const stages = mode === "url" ? URL_STAGES : MESSAGE_STAGES;

  return (
    <form aria-busy={busy} className="composer" data-mode={mode} noValidate onSubmit={submit}>
      <SlidingTabs label="What to investigate" onChange={switchMode} options={[{ value: "url", label: "Link or domain" }, { value: "message", label: "Message or email" }]} value={mode} />

      {mode === "url" ? (
        <div className="composer-row">
          <label className="field" data-invalid={Boolean(fieldError)} htmlFor="composer-url">
            <Globe2 aria-hidden="true" color="var(--muted)" size={19} />
            <span className="sr-only">Suspicious link or domain</span>
            <input aria-describedby={fieldError ? "composer-error" : undefined} aria-invalid={Boolean(fieldError)} autoComplete="off" disabled={busy} id="composer-url" inputMode="url" onChange={(event) => setTarget(event.target.value)} placeholder="Paste a suspicious link or domain" spellCheck={false} value={target} />
          </label>
          <button className="pill pill-signal" disabled={busy} type="submit">
            {busy ? "Investigating" : "Investigate"} <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <label className="sr-only" htmlFor="composer-sender">Sender (optional)</label>
          <input className="input" disabled={busy} id="composer-sender" onChange={(event) => setSender(event.target.value)} placeholder="Sender address (optional)" value={sender} />
          <label className="sr-only" htmlFor="composer-text">Suspicious message</label>
          <textarea aria-describedby={fieldError ? "composer-error" : undefined} aria-invalid={Boolean(fieldError)} className="textarea" disabled={busy} id="composer-text" maxLength={MAX_MESSAGE_LENGTH} onChange={(event) => setText(event.target.value)} placeholder="Paste the SMS, WhatsApp message or email text. Remove any passwords or OTPs first." value={text} />
          <div className="composer-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="muted small" style={{ paddingLeft: 6 }}>Links are analysed, never opened · {text.length.toLocaleString()}/{MAX_MESSAGE_LENGTH.toLocaleString()}</span>
            <button className="pill pill-signal" disabled={busy} type="submit">
              {busy ? "Analysing" : "Analyse"} <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {fieldError && <div id="composer-error" style={{ padding: "0 8px" }}><FieldError>{fieldError}</FieldError></div>}
      {apiError && <div style={{ marginTop: 10 }}><ApiNotice error={apiError} /></div>}

      {busy && (
        <ol aria-live="polite" className="progress">
          {stages.map((label, index) => (
            <li data-state={index < stage ? "done" : index === stage ? "active" : "waiting"} key={label}>{label}</li>
          ))}
        </ol>
      )}

      {showSamples && !busy && (
        <div className="composer-foot">
          <span className="chips">
            {(mode === "url" ? SAMPLE_URLS : SAMPLE_MESSAGES).map((sample) => (
              <button
                className="chip"
                key={sample.label}
                onClick={() => {
                  setFieldError("");
                  setApiError(null);
                  if ("value" in sample) setTarget(sample.value);
                  else {
                    setText(sample.text);
                    setSender(sample.sender);
                  }
                }}
                type="button"
              >
                {sample.label}
              </button>
            ))}
          </span>
          <span>Passive checks · no scripts run · never asks for passwords</span>
        </div>
      )}
    </form>
  );
}
