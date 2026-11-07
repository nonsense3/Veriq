// Times the real explanation prompt against the configured model. Dev diagnostic only.
import { assessMessage } from "@veriq/analysis";
import { explainReport } from "../src/ai/explain";

const report = assessMessage({
  reportId: "00000000-0000-4000-8000-000000000001",
  createdAt: new Date().toISOString(),
  sender: "alerts@sbi-kyc-help.in",
  text: "Dear Customer, your SBI account will be BLOCKED within 24 hours due to pending KYC. Update KYC immediately at https://sbi-kyc-update.in/verify and share the OTP sent to your mobile to confirm. - SBI Team",
});
const started = Date.now();
const ai = await explainReport(report);
console.log(`status ${ai.status} in ${Date.now() - started} ms`);
console.log(ai.note);
console.log(ai.summary);
for (const item of ai.explanations.slice(0, 4)) console.log(`  ${item.findingId}: ${item.text}`);
