/**
 * Evaluates a JavaScript expression inside a page in headless Edge/Chrome at a chosen device width
 * and prints the result. Useful for layout forensics that a screenshot cannot answer.
 *
 * Usage: node tools/eval-in-page.mjs <url> <width> <path-to-expression.js>
 * The expression file must contain a single expression (an IIFE returning a string is typical).
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, widthArg, exprFile] = process.argv.slice(2);
if (!url || !exprFile) {
  console.error("usage: node tools/eval-in-page.mjs <url> <width> <expression.js>");
  process.exit(1);
}
const width = Number(widthArg ?? 390);
const expression = await readFile(exprFile, "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
];
const browser = CANDIDATES.find((p) => p && !p.includes("undefined"));
const port = 9445;
const dir = await mkdtemp(join(tmpdir(), "veriq-eval-"));
const child = spawn(
  browser,
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--hide-scrollbars", "about:blank"],
  { stdio: "ignore" },
);

let wsUrl = "";
for (let i = 0; i < 60 && !wsUrl; i++) {
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {
    await sleep(250);
  }
}
const ws = new WebSocket(wsUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}, sessionId) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((res) => pending.set(mid, res));
};

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send(
  "Emulation.setDeviceMetricsOverride",
  { width, height: 900, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: 900 },
  sessionId,
);
await send("Page.navigate", { url }, sessionId);
await sleep(Number(process.env.DELAY ?? 5000));
const { result, exceptionDetails } = await send(
  "Runtime.evaluate",
  { expression, returnByValue: true, awaitPromise: true },
  sessionId,
);
console.log(exceptionDetails ? `error: ${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ""}` : result.value);

ws.close();
child.kill();
await rm(dir, { recursive: true, force: true }).catch(() => {});
