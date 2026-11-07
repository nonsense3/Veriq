import type { PublicError } from "@veriq/contracts";
import { CircleAlert, CircleCheck, Info, OctagonX, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export type Tone = "error" | "warning" | "info" | "success";

const ICONS = { error: OctagonX, warning: TriangleAlert, info: Info, success: CircleCheck } as const;

/**
 * One notice anatomy everywhere: tone colour, icon, short title, one-line message, optional actions and a
 * reference for unexpected failures. Errors are announced assertively; other tones politely.
 */
export function Notice({ tone, title, children, actions, reference }: { tone: Tone; title: string; children?: ReactNode; actions?: ReactNode; reference?: string | undefined }) {
  const Icon = ICONS[tone];
  return (
    <div className={`notice tone-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="n-icon" aria-hidden="true"><Icon size={16} strokeWidth={2.2} /></span>
      <strong>{title}</strong>
      {children ? <p>{children}</p> : <span />}
      {actions && <div className="n-actions">{actions}</div>}
      {reference && <span className="n-ref">Reference {reference}</span>}
    </div>
  );
}

/** Map API error codes to a tone: refusals and validation are warnings, outages are errors, setup gaps are info. */
export function toneForError(error: Pick<PublicError, "code">): Tone {
  if (/NOT_CONFIGURED/.test(error.code)) return "info";
  if (/BLOCKED|INVALID|URL_|HOST_NOT_PUBLIC|UNSUPPORTED|RATE_LIMITED|PAYLOAD|AUTH_REQUIRED|NOT_FOUND/.test(error.code)) return "warning";
  return "error";
}

export function ApiNotice({ error, actions }: { error: PublicError; actions?: ReactNode }) {
  const reference = error.correlationId && error.correlationId !== "client" ? error.correlationId.slice(0, 8) : undefined;
  return (
    <Notice actions={actions} reference={toneForError(error) === "error" ? reference : undefined} title={error.title} tone={toneForError(error)}>
      {error.message}
    </Notice>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  return (
    <p className="field-error" role="alert">
      <CircleAlert aria-hidden="true" size={14} /> {children}
    </p>
  );
}
