"use client";

import { computeCommitment, registryKeyFor } from "@veriq/analysis/integrity";
import { verificationBundleSchema, type VerificationBundle } from "@veriq/contracts";
import { CircleAlert, FileJson, ShieldCheck, ShieldX } from "lucide-react";
import { ChangeEvent, DragEvent, useState } from "react";
import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { InlineStatus } from "@/components/toast";

const ABI = parseAbi([
  "function getRecord(bytes32 key) view returns (bytes32 commitment, bytes32 parent, address registrar, uint64 registeredAt, uint16 schemaVersion)",
  "function validations(bytes32 key) view returns (uint32)",
  "function disputes(bytes32 key) view returns (uint32)",
]);

type Outcome =
  | { status: "verified" | "mismatch" | "missing"; chainId: number; recomputed: string; onChain: string | null; registryKey: string; registrar: string | null; registeredAt: string | null; parent: string | null; validations: number; disputes: number; bundleConsistent: boolean }
  | { status: "network"; message: string };

export default function VerifyPage() {
  const [bundle, setBundle] = useState<VerificationBundle | null>(null);
  const [fileName, setFileName] = useState("");
  const [rpc, setRpc] = useState("http://127.0.0.1:8545");
  const [contract, setContract] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function load(file: File) {
    setOutcome(null);
    setError("");
    try {
      if (!/\.json$/i.test(file.name) && file.type !== "application/json") throw new Error("Choose a .json report bundle. Other file types can't be verified.");
      if (file.size > 2_000_000) throw new Error("That file is larger than 2 MB, so it isn't a Veriq report bundle.");
      let json: unknown;
      try {
        json = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      } catch {
        throw new Error("This .json file is damaged or isn't valid JSON.");
      }
      const parsed = verificationBundleSchema.safeParse(json);
      if (!parsed.success) throw new Error("This JSON isn't a Veriq report bundle. Download one from a report page using the Bundle button.");
      setBundle(parsed.data);
      setFileName(file.name);
      if (parsed.data.registry.contractAddress) setContract(parsed.data.registry.contractAddress);
      if (parsed.data.registry.rpcHint) setRpc(parsed.data.registry.rpcHint);
    } catch (caught) {
      setBundle(null);
      setError((caught as Error).message);
    }
  }

  async function verify() {
    if (!bundle) return;
    setBusy(true);
    setOutcome(null);
    try {
      // Everything below runs in this browser: the commitment is recomputed locally and the chain is read directly.
      const recomputed = computeCommitment(bundle.report, bundle.nonce);
      const registryKey = registryKeyFor(bundle.report.reportId) as Hex;
      const client = createPublicClient({ transport: http(rpc, { timeout: 10_000 }) });
      const chainId = await client.getChainId();
      const address = contract as Address;
      const [onChain, parent, registrar, registeredAt] = await client.readContract({ address, abi: ABI, functionName: "getRecord", args: [registryKey] });
      const [validations, disputes] = await Promise.all([
        client.readContract({ address, abi: ABI, functionName: "validations", args: [registryKey] }),
        client.readContract({ address, abi: ABI, functionName: "disputes", args: [registryKey] }),
      ]);
      const registered = registeredAt > 0n;
      setOutcome({
        status: !registered ? "missing" : onChain.toLowerCase() === recomputed.toLowerCase() ? "verified" : "mismatch",
        chainId,
        recomputed,
        onChain: registered ? onChain : null,
        registryKey,
        registrar: registered ? registrar : null,
        registeredAt: registered ? new Date(Number(registeredAt) * 1000).toISOString() : null,
        parent: registered && !/^0x0+$/.test(parent) ? parent : null,
        validations: Number(validations),
        disputes: Number(disputes),
        bundleConsistent: bundle.commitment.toLowerCase() === recomputed.toLowerCase(),
      });
    } catch (caught) {
      setOutcome({ status: "network", message: (caught as Error).message.split("\n")[0] ?? "The chain could not be read." });
    } finally {
      setBusy(false);
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDrag(false);
    const file = event.dataTransfer.files[0];
    if (file) void load(file);
  };

  const tone = outcome?.status === "verified" ? "tone-success" : outcome?.status === "mismatch" ? "tone-error" : "tone-warning";
  const heading = outcome?.status === "verified" ? "Verified" : outcome?.status === "mismatch" ? "Altered" : outcome?.status === "missing" ? "Not registered" : "Chain unreachable";
  const detail = outcome?.status === "verified"
    ? "This exact report was sealed on-chain and has not changed since."
    : outcome?.status === "mismatch"
      ? "This file does not match its on-chain record. Don't trust its contents."
      : outcome?.status === "missing"
        ? "No record exists for this report on that chain."
        : "Check the RPC address and try again.";

  return (
    <>
      <SiteHeader />
      <main className="page container" id="main-content">
        <div className="page-head">
          <div>
            <h1>Was this report altered?</h1>
            <p>Drop a Veriq report bundle (.json). It's checked against the public ledger right here in your browser.</p>
          </div>
        </div>
        <div className="layout-main">
          <section aria-labelledby="verify-title" className="card" style={{ display: "grid", gap: 14 }}>
            <h2 className="sr-only" id="verify-title">Verify a report</h2>
            <div className="dropzone" data-drag={drag} onDragLeave={() => setDrag(false)} onDragOver={(event) => { event.preventDefault(); setDrag(true); }} onDrop={onDrop}>
              <FileJson aria-hidden="true" color="var(--signal)" size={30} />
              <p>{fileName ? <>Loaded <strong>{fileName}</strong></> : "Drop the report bundle here"}</p>
              <span className="muted small">.json file named veriq-report-….json · up to 2 MB · from a report's Bundle button</span>
              <label className="pill pill-ghost pill-sm">
                Choose file
                <input accept="application/json,.json" className="sr-only" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void load(file); }} type="file" />
              </label>
            </div>
            <InlineStatus tone="warning">{error || undefined}</InlineStatus>
            {bundle && (
              <dl className="kv">
                <div><dt>Verdict in file</dt><dd>{bundle.report.risk.label}</dd></div>
                <div><dt>Subject</dt><dd className="wrap">{bundle.report.subject.display}</dd></div>
                <div><dt>Created</dt><dd>{new Date(bundle.report.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd></div>
              </dl>
            )}
            <details>
              <summary className="text-link small" style={{ cursor: "pointer" }}>Network settings</summary>
              <div className="form-grid" style={{ marginTop: 10 }}>
                <label>RPC endpoint<input className="input" onChange={(event) => setRpc(event.target.value)} value={rpc} /></label>
                <label>Registry address<input className="input" onChange={(event) => setContract(event.target.value)} placeholder="0x…" value={contract} /></label>
              </div>
            </details>
            <button className="pill pill-dark" disabled={!bundle || !contract || busy} onClick={() => void verify()} style={{ justifySelf: "start" }} type="button">
              <ShieldCheck size={15} /> {busy ? "Checking" : "Verify"}
            </button>

            {outcome && (
              <div className={`verdict-box ${tone}`} role="status">
                {outcome.status === "verified" ? <ShieldCheck size={30} /> : outcome.status === "mismatch" ? <ShieldX size={30} /> : <CircleAlert size={30} />}
                <h2>{heading}</h2>
                <p>{detail}</p>
                {outcome.status !== "network" && outcome.registeredAt && (
                  <p className="small">Sealed {new Date(outcome.registeredAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · {outcome.validations} confirm · {outcome.disputes} dispute{outcome.parent ? " · revision of an earlier report" : ""}</p>
                )}
              </div>
            )}
          </section>
          <aside className="card">
            <div className="card-head"><h2>Integrity, not truth</h2></div>
            <ol className="actions-list">
              <li><span className="n">1</span> Your browser re-creates the report's fingerprint.</li>
              <li><span className="n">2</span> It reads the sealed fingerprint from the public ledger.</li>
              <li><span className="n">3</span> Any edit to the file breaks the match.</li>
            </ol>
            <p className="muted small" style={{ marginTop: 12 }}>A match proves the report wasn't changed. It doesn't prove the verdict is right; check community reviews too.</p>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}