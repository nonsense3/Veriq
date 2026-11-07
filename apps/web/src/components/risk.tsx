import type { RiskClass, Severity } from "@veriq/contracts";
import { CircleCheck, CircleHelp, OctagonAlert, ShieldAlert, TriangleAlert } from "lucide-react";

const ICONS: Record<RiskClass, typeof CircleCheck> = {
  low_risk: CircleCheck,
  suspicious: TriangleAlert,
  high_risk: ShieldAlert,
  confirmed_malicious: OctagonAlert,
  inconclusive: CircleHelp,
};

/** Risk is always conveyed by text and icon as well as colour. */
export function RiskBadge({ classification, label }: { classification: RiskClass; label: string }) {
  const Icon = ICONS[classification];
  return (
    <span className={`risk risk-${classification}`}>
      <Icon aria-hidden="true" size={15} />
      {label}
    </span>
  );
}

export function SeverityTag({ severity }: { severity: Severity }) {
  return <span className={`sev sev-${severity}`}>{severity}</span>;
}
