/**
 * Responsive audit: drives headless Edge/Chrome over the DevTools protocol and reports, per device
 * preset and per page, horizontal overflow, the elements causing it, and tap targets below 44px.
 *
 * No dependencies: it uses Node's built-in WebSocket and fetch.
 *
 * Usage:  node tools/responsive-audit.mjs [baseUrl]
 * The web app must already be running (pnpm dev).
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { createServer } from "node:net";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const SHOT_DIR = process.env.SHOT_DIR ?? "";

const ALL_PAGES = ["/", "/dashboard", "/repository", "/verify", "/sign-in", "/profile"];
const PAGES = process.env.ONLY_PAGES ? process.env.ONLY_PAGES.split(",") : ALL_PAGES;
/** When set, capture successive viewport-height slices instead of one tall image. */
const SLICES = Number(process.env.SLICES ?? 0);

const ALL_DEVICES = [
  { name: "phone-360", width: 360, height: 740, dpr: 3, mobile: true },
  { name: "phone-375", width: 375, height: 667, dpr: 2, mobile: true },
  { name: "phone-390", width: 390, height: 844, dpr: 3, mobile: true },
  { name: "phone-430", width: 430, height: 932, dpr: 3, mobile: true },
  { name: "tablet-768", width: 768, height: 1024, dpr: 2, mobile: true },
  { name: "tablet-820", width: 820, height: 1180, dpr: 2, mobile: true },
  { name: "tablet-1024", width: 1024, height: 1366, dpr: 2, mobile: true },
  { name: "desktop-1440", width: 1440, height: 1000, dpr: 1, mobile: false },
];
const DEVICES = process.env.ONLY_DEVICE
  ? ALL_DEVICES.filter((d) => process.env.ONLY_DEVICE.split(",").includes(d.name))
  : ALL_DEVICES;

const EDGE_CANDIDATES = [
  `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
];

/** Page-side probe. Returns overflow and tap-target findings for the current viewport. */
/**
 * Page-side probe. Takes the device width because a mobile layout viewport grows to fit
 * overflowing content: window.innerWidth then reports the expanded width, the overflow looks
 * like zero, and fixed elements anchored to the right edge end up off the physical screen.
 */
const probeFor = (deviceWidth) => `(() => {
  const vw = ${deviceWidth};
  const layoutWidth = window.innerWidth;
  const describe = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
      : '';
    return el.tagName.toLowerCase() + id + cls;
  };
  // An element whose overflow an ancestor already clips cannot widen the page, so it is not a bug.
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflowX !== 'visible' || o.overflow === 'hidden' || o.overflow === 'clip') return true;
    }
    return false;
  };
  const hidden = (el) => el.classList.contains('sr-only') || el.closest('.sr-only') !== null;

  const all = Array.from(document.querySelectorAll('body *'));
  const hits = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.position === 'fixed') continue;
    if (hidden(el) || clipped(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const overshoot = Math.round(r.right - vw);
    if (overshoot > 1) hits.push({ el, overshoot, width: Math.round(r.width), left: Math.round(r.left) });
  }
  // Report the outermost offenders only: if an ancestor already overflows, the child is a symptom.
  const hitSet = new Set(hits.map((h) => h.el));
  const outer = hits.filter((h) => {
    for (let p = h.el.parentElement; p; p = p.parentElement) if (hitSet.has(p)) return false;
    return true;
  });
  const offenders = (outer.length ? outer : hits).map((h) => ({
    sel: describe(h.el), overshoot: h.overshoot, width: h.width, left: h.left,
  }));
  // The innermost offenders are the actual cause: an unbreakable string, a table, or a grid track
  // that cannot shrink. The outermost ones are just the containers being stretched by them.
  const leaves = hits
    .filter((h) => !hits.some((o) => o.el !== h.el && h.el.contains(o.el)))
    .map((h) => ({ sel: describe(h.el), overshoot: h.overshoot, width: h.width, text: (h.el.textContent || '').trim().slice(0, 40) }));

  const small = [];
  for (const el of document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="tab"]')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
    if (hidden(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // A control wrapped in a label that is itself a large target is reachable: the label takes
    // the tap. Checkboxes are the usual case.
    const label = el.closest('label');
    if (label && label !== el && label.getBoundingClientRect().height >= 40) continue;
    if (r.height < 40 || r.width < 32) {
      small.push({ sel: describe(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 24) });
    }
  }

  // Fixed elements cannot widen the page, so they are excluded above, but one that runs past the
  // viewport edge is clipped and unusable. Headers and floating controls are the usual case.
  const fixedBleed = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (hidden(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const over = Math.round(r.right - vw);
    const under = Math.round(-r.left);
    if (over > 1 || under > 1) {
      fixedBleed.push({ sel: describe(el), right: Math.round(r.right), left: Math.round(r.left), width: Math.round(r.width) });
    }
  }

  return JSON.stringify({
    vw,
    layoutWidth,
    fixedBleed: fixedBleed.slice(0, 8),
    controls: (() => {
      const c = document.querySelector('.controls');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      return {
        left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
        position: cs.position, rightStyle: cs.right,
        kids: Array.from(c.children).map((k) => {
          const kr = k.getBoundingClientRect();
          return describe(k) + ' ' + Math.round(kr.left) + '..' + Math.round(kr.right);
        }),
      };
    })(),
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    docHeight: document.documentElement.scrollHeight,
    croppedComposer: Array.from(document.querySelectorAll('.composer')).flatMap((form) => {
      const bounds = form.closest('.stage')?.getBoundingClientRect() ?? form.getBoundingClientRect();
      return [form, ...form.querySelectorAll('.tabs, input, textarea, button[type="submit"]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.left < bounds.left - 1 || r.right > bounds.right + 1);
      }).map(describe);
    }),
    misplacedArt: [
      ['.proof-art', '.proof-flow'], ['.cta-art', '.cta-stage h2'],
      ['.cta-art', '.cta-button'], ['.investigation-art', '.investigation-content']
    ].filter(([artSelector, contentSelector]) => {
      const art = document.querySelector(artSelector), content = document.querySelector(contentSelector);
      if (!art || !content || ${deviceWidth} > 900) return false;
      const a = art.getBoundingClientRect(), b = content.getBoundingClientRect();
      return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    }),
    artOverlaps: (() => {
      const art = document.querySelector('.views-art');
      if (!art) return [];
      const a = art.getBoundingClientRect();
      return Array.from(document.querySelectorAll('.views-grid .view-card')).filter((card) => {
        const b = card.getBoundingClientRect();
        return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      }).map((card) => card.querySelector('h3')?.textContent);
    })(),
    overflow: offenders.sort((a, b) => b.overshoot - a.overshoot).slice(0, 12),
    overflowCause: leaves.sort((a, b) => b.overshoot - a.overshoot).slice(0, 8),
    small: small.slice(0, 12),
    fontSmall: Array.from(document.querySelectorAll('p, li, span, div'))
      .filter((el) => { const f = parseFloat(getComputedStyle(el).fontSize); return f > 0 && f < 12 && (el.textContent || '').trim().length > 8; })
      .slice(0, 6)
      .map((el) => ({ sel: describe(el), size: getComputedStyle(el).fontSize })),
  });
})()`;

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.sessions = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method && this.onEvent) {
        this.onEvent(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 45000);
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** How long to settle after navigation before probing. Entrance animations need a moment. */
const PROBE_DELAY = Number(process.env.PROBE_DELAY ?? 2600);

async function main() {
  const browserPath = EDGE_CANDIDATES.find((p) => p && !p.includes("undefined"));
  const userDataDir = await mkdtemp(join(tmpdir(), "veriq-audit-"));
  const reservation = createServer();
  await new Promise((resolvePort, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolvePort); });
  const port = reservation.address().port;
  await new Promise((resolvePort) => reservation.close(resolvePort));

  const child = spawn(
    browserPath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let wsUrl = "";
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await res.json()).webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch {
      await sleep(250);
    }
  }
  if (!wsUrl) throw new Error("could not reach the browser debugging endpoint");

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new Cdp(ws);

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);

  if (SHOT_DIR) await mkdir(SHOT_DIR, { recursive: true });

  const report = [];
  let runtimeErrors = [];
  cdp.onEvent = (event) => {
    if (event.method === "Runtime.exceptionThrown") {
      const detail = event.params.exceptionDetails;
      runtimeErrors.push(detail.exception?.description ?? detail.text);
    }
    if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") {
      const message = event.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ");
      if (/THREE|WebGL|shader/i.test(message)) runtimeErrors.push(message);
    }
  };
  if (process.env.LIVE_SMOKE === "1") {
    const evaluate = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value;
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await cdp.send("Page.navigate", { url: BASE + "/dashboard" }, sessionId);
    await sleep(PROBE_DELAY);
    for (let retry = 0; retry < 100 && !await evaluate(`document.querySelector('.cyber-cursor')?.dataset.cursorReady === 'true'`); retry++) await sleep(100);
    const submitted = await evaluate(`(() => {
      const input = document.querySelector('.composer input');
      const form = document.querySelector('.composer');
      if (!input || !form) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'https://example.com');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!submitted) throw new Error("Live smoke: investigation form missing");
    await sleep(100);
    await evaluate(`document.querySelector('.composer button[type="submit"]').click(); true`);
    let complete = false;
    for (let retry = 0; retry < 150; retry++) {
      await sleep(1000);
      complete = await evaluate(`location.pathname.replace(/\\/$/, '') === '/report' && Boolean(document.querySelector('.verdict'))`);
      if (complete) break;
      const failure = await evaluate(`document.querySelector('.composer [role="alert"]')?.textContent ?? ''`);
      if (failure) throw new Error("Live smoke: " + failure);
    }
    if (!complete) throw new Error("Live smoke: report did not render after submission");
    console.log("Live smoke: mobile form submission navigated to a rendered investigation report.");
  }
  if (process.env.INPUT_AUDIT === "1") {
    const evaluate = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value;
    // Exercise the enabled cursor path even when headless Edge reports a low hardware tier.
    const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 12 }); Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });` }, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }, sessionId);
    await cdp.send("Page.navigate", { url: BASE }, sessionId);
    await sleep(PROBE_DELAY);
    for (let retry = 0; retry < 100 && !await evaluate(`document.querySelector('.cyber-cursor')?.dataset.cursorReady === 'true'`); retry += 1) await sleep(100);
    await evaluate(`window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 180, clientY: 180 })); true`);
    await sleep(100);
    const desktopVisible = await evaluate(`!document.querySelector('.cyber-cursor').hidden`);
    if (!desktopVisible) throw new Error("Desktop cursor did not activate after a mouse move");
    console.log("Cursor test environment: " + await evaluate(`JSON.stringify({ fine: matchMedia('(hover: hover) and (pointer: fine)').matches, coarse: matchMedia('(any-pointer: coarse)').matches, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory })`));
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 1, mobile: true }, sessionId);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
    await sleep(150);
    await evaluate(`window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', clientX: 70, clientY: 70 })); true`);
    await sleep(50);
    const tapVisible = await evaluate(`Boolean(document.querySelector('.tap-feedback'))`);
    if (!tapVisible) throw new Error("Touch acknowledgement was not shown");
    const tapPositioned = await evaluate(`(() => { const r = document.querySelector('.tap-feedback').getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - 70) < 1 && Math.abs((r.top + r.bottom) / 2 - 70) < 1; })()`);
    if (!tapPositioned) throw new Error("Touch acknowledgement was not centered on the tap");
    await sleep(600);
    const tapCleared = await evaluate(`!document.querySelector('.tap-feedback')`);
    if (!tapCleared) throw new Error("Touch acknowledgement did not expire");
    await evaluate(`window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', clientX: 150, clientY: 240 })); true`);
    await sleep(50);
    const tapMoved = await evaluate(`(() => { const r = document.querySelector('.tap-feedback').getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - 150) < 1 && Math.abs((r.top + r.bottom) / 2 - 240) < 1; })()`);
    if (!tapMoved) throw new Error("Touch acknowledgement stayed at the previous tap");
    await evaluate(`window.scrollTo(0, 100); true`);
    await sleep(50);
    const scrollCleared = await evaluate(`!document.querySelector('.tap-feedback')`);
    if (!scrollCleared) throw new Error("Touch acknowledgement remained after scrolling");
    const touchHidden = await evaluate(`document.querySelector('.cyber-cursor').hidden && getComputedStyle(document.querySelector('.cyber-cursor')).display === 'none'`);
    if (!touchHidden) throw new Error("Cursor remained visible after desktop-to-touch transition");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }, sessionId);
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, sessionId);
    await sleep(100);
    const reducedHidden = await evaluate(`document.querySelector('.cyber-cursor').hidden`);
    if (!reducedHidden) throw new Error("Cursor remained visible after reduced-motion change");
    await cdp.send("Emulation.setEmulatedMedia", { features: [] }, sessionId);
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }, sessionId);
    console.log(`Cursor lifecycle: desktop visible=${desktopVisible}; touch cursor hidden=${touchHidden}; tap shown=${tapVisible}; centered=${tapPositioned}; follows next tap=${tapMoved}; expired=${tapCleared}; scroll cleared=${scrollCleared}; reduced-motion hidden=${reducedHidden}`);
  }
  for (const device of DEVICES) {
    for (const path of PAGES) {
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: device.width,
          height: device.height,
          deviceScaleFactor: 1,
          mobile: device.mobile,
          screenWidth: device.width,
          screenHeight: device.height,
        },
        sessionId,
      );
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: device.mobile, maxTouchPoints: 5 }, sessionId);

      runtimeErrors = [];
      await cdp.send("Page.navigate", { url: BASE + path }, sessionId);
      await sleep(PROBE_DELAY);

      const { result } = await cdp.send(
        "Runtime.evaluate",
        { expression: probeFor(device.width), returnByValue: true, awaitPromise: false },
        sessionId,
      );
      let data;
      try {
        data = JSON.parse(result.value);
      } catch {
        data = { error: String(result.value).slice(0, 200) };
      }
      report.push({ device: device.name, path, ...data, runtimeErrors: [...runtimeErrors] });

      if (SHOT_DIR) {
        const slug = `${device.name}${path.replace(/[^a-z0-9-]+/gi, "_") || "_root"}`.slice(0, 60);
        if (SLICES > 0) {
          for (let i = 0; i < SLICES; i++) {
            const y = i * device.height;
            if (y >= data.docHeight) break;
            await cdp.send(
              "Runtime.evaluate",
              { expression: `window.scrollTo(0, ${y}); 1`, returnByValue: true },
              sessionId,
            );
            await sleep(1400);
            // Scenes boot lazily on intersection; wait for visible artwork before taking a slice.
            for (let attempt = 0; attempt < 60; attempt++) {
              const { result: ready } = await cdp.send("Runtime.evaluate", { expression: `Array.from(document.querySelectorAll('.gl-host')).filter(el => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }).every(el => el.dataset.ready === 'true' || el.querySelector('.gl-fallback'))`, returnByValue: true }, sessionId);
              if (ready.value) break;
              await sleep(100);
            }
            const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
            await writeFile(join(SHOT_DIR, `${slug}-${String(i).padStart(2, "0")}.png`), Buffer.from(shot.data, "base64"));
          }
          await cdp.send("Runtime.evaluate", { expression: "window.scrollTo(0, 0); 1", returnByValue: true }, sessionId);
        } else {
          const shot = await cdp.send(
            "Page.captureScreenshot",
            { format: "png", captureBeyondViewport: true, optimizeForSpeed: true },
            sessionId,
          );
          await writeFile(join(SHOT_DIR, `${slug}.png`), Buffer.from(shot.data, "base64"));
        }
      }
    }
  }

  // Report
  let problems = 0;
  for (const row of report) {
    const bleed = row.scrollWidth - row.vw;
    const issues = [];
    if (bleed > 1) issues.push(`H-SCROLL +${bleed}px (scrollWidth ${row.scrollWidth} vs device ${row.vw})`);
    if (row.layoutWidth - row.vw > 1) {
      issues.push(`LAYOUT VIEWPORT STRETCHED to ${row.layoutWidth}px (device ${row.vw}px): content forced it wider`);
    }
    if (row.overflow?.length) {
      issues.push(
        "overflowing: " + row.overflow.map((o) => `${o.sel} +${o.overshoot}px (w${o.width})`).join(" | "),
      );
    }
    if (row.overflowCause?.length) {
      issues.push(
        "caused by: " + row.overflowCause.map((o) => `${o.sel} +${o.overshoot}px (w${o.width}) "${o.text}"`).join(" | "),
      );
    }
    if (row.small?.length) {
      issues.push("small targets: " + row.small.map((s) => `${s.sel} ${s.w}x${s.h}`).join(" | "));
    }
    if (row.fontSmall?.length) {
      issues.push("tiny text: " + row.fontSmall.map((f) => `${f.sel} ${f.size}`).join(" | "));
    }
    if (row.fixedBleed?.length) {
      issues.push(
        "fixed element off-screen: " +
          row.fixedBleed.map((f) => `${f.sel} left ${f.left} right ${f.right} (viewport ${row.vw})`).join(" | "),
      );
    }
    if (row.error) issues.push("probe error: " + row.error);
    if (row.croppedComposer?.length) issues.push("clipped form content: " + row.croppedComposer.join(", "));
    if (row.misplacedArt?.length) issues.push("art/content overlap: " + JSON.stringify(row.misplacedArt));
    if (row.artOverlaps?.length) issues.push("particle art overlaps cards: " + row.artOverlaps.join(", "));
    if (row.runtimeErrors?.length) issues.push("runtime errors: " + row.runtimeErrors.join(" | "));
    if (issues.length) {
      problems++;
      console.log(`\n### ${row.device} ${row.path}  (height ${row.docHeight})`);
      for (const i of issues) console.log("  - " + i);
    }
  }
  console.log(`\n${problems} of ${report.length} page/device combinations reported findings.`);
  if (process.env.SHOW_CONTROLS) {
    for (const row of report) {
      console.log(`${row.device} ${row.path}: ${JSON.stringify(row.controls)}`);
    }
  }

  ws.close();
  child.kill();
  if (dirname(resolve(userDataDir)) !== resolve(tmpdir()) || !basename(userDataDir).startsWith("veriq-audit-")) throw new Error("Unexpected audit temp directory; refusing cleanup");
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}

main().catch((err) => {
  console.error("audit failed:", err.message);
  process.exit(1);
});
