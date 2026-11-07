/**
 * Point-cloud samplers for Veriq's security forms: shield, padlock, network globe and ledger blocks.
 * Every shape fits inside a radius of ~1.4 units, centred on the origin. Particles are sampled
 * independently per shape, so morphing between two shapes sends each particle on its own path.
 */
export type ShapeName = "shield" | "lock" | "globe" | "blocks" | "fingerprint" | "envelope" | "key" | "server" | "torus-knot" | "helix" | "nexus";

export type Rng = () => number;

export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const jitter = (rng: Rng, amount: number) => (rng() - 0.5) * 2 * amount;

type Line = { points: Array<[number, number]>; cumulative: number[]; total: number };

function polyline(points: Array<[number, number]>): Line {
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(bx - ax, by - ay));
  }
  return { points, cumulative, total: cumulative[cumulative.length - 1]! };
}

function onLine(line: Line, u: number): [number, number] {
  const target = u * line.total;
  let low = 0;
  let high = line.cumulative.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (line.cumulative[mid]! < target) low = mid;
    else high = mid;
  }
  const span = line.cumulative[high]! - line.cumulative[low]! || 1;
  const t = (target - line.cumulative[low]!) / span;
  const [ax, ay] = line.points[low]!;
  const [bx, by] = line.points[high]!;
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

function shield(count: number, rng: Rng): Float32Array {
  const out = new Float32Array(count * 3);
  const top = (x: number) => 0.86 + 0.24 * (1 - Math.abs(x));
  const half = (y: number) => (y >= 0.15 ? 1 : Math.pow(Math.max(0, (y + 1.3) / 1.45), 0.62));
  const bulge = (x: number, y: number) => {
    const w = Math.max(half(y), 0.001);
    return 0.3 * Math.max(0, 1 - (x / w) ** 2);
  };
  const right: Array<[number, number]> = [];
  for (let i = 0; i <= 30; i += 1) right.push([i / 30, top(i / 30)]);
  for (let i = 1; i <= 20; i += 1) right.push([1, 0.86 - (0.71 * i) / 20]);
  for (let i = 1; i <= 50; i += 1) {
    const y = 0.15 - (1.45 * i) / 50;
    right.push([half(y), y]);
  }
  const outline = polyline([...right.slice().reverse().map(([x, y]) => [-x, y] as [number, number]), ...right.slice(1)]);
  const check = polyline([[-0.42, 0.02], [-0.1, -0.32], [0.46, 0.36]]);

  for (let i = 0; i < count; i += 1) {
    const r = rng();
    let x: number, y: number, z: number;
    if (r < 0.36) {
      [x, y] = onLine(outline, rng());
      x += jitter(rng, 0.025);
      y += jitter(rng, 0.025);
      z = jitter(rng, 0.09);
    } else if (r < 0.8) {
      do {
        x = jitter(rng, 1);
        y = -1.3 + rng() * 2.4;
      } while (Math.abs(x) > half(y) || y > top(x));
      z = (rng() < 0.7 ? 1 : -0.6) * bulge(x, y) + jitter(rng, 0.02);
    } else {
      [x, y] = onLine(check, rng());
      x += jitter(rng, 0.04);
      y += jitter(rng, 0.04);
      z = bulge(x, y) + 0.1 + jitter(rng, 0.03);
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y + 0.1;
    out[i * 3 + 2] = z;
  }
  return out;
}

function boxEdge(rng: Rng, hx: number, y0: number, y1: number, hz: number): [number, number, number] {
  const edge = Math.floor(rng() * 12);
  const t = rng();
  const a = edge & 1 ? 1 : -1;
  const b = edge & 2 ? 1 : -1;
  const group = Math.floor(edge / 4);
  if (group === 0) return [-hx + t * 2 * hx, b > 0 ? y1 : y0, a * hz];
  if (group === 1) return [a * hx, y0 + t * (y1 - y0), b * hz];
  return [a * hx, b > 0 ? y1 : y0, -hz + t * 2 * hz];
}

function lock(count: number, rng: Rng): Float32Array {
  const out = new Float32Array(count * 3);
  const hw = 0.85, yb = -1.2, yt = 0.1, hd = 0.26;
  const keyhole = (x: number, y: number) => Math.hypot(x, y + 0.38) < 0.17 || (Math.abs(x) < 0.065 && y < -0.38 && y > -0.78);
  for (let i = 0; i < count; i += 1) {
    const r = rng();
    let x: number, y: number, z: number;
    if (r < 0.32) {
      const radius = 0.56, tube = 0.11, cy = 0.55;
      let cx: number, cyy: number, dx: number, dy: number;
      if (rng() < 0.68) {
        const theta = rng() * Math.PI;
        cx = radius * Math.cos(theta);
        cyy = cy + radius * Math.sin(theta);
        dx = Math.cos(theta);
        dy = Math.sin(theta);
      } else {
        const side = rng() < 0.5 ? -1 : 1;
        cx = side * radius;
        cyy = yt + rng() * (cy - yt);
        dx = side;
        dy = 0;
      }
      const phase = rng() * Math.PI * 2;
      x = cx + dx * tube * Math.cos(phase);
      y = cyy + dy * tube * Math.cos(phase);
      z = tube * Math.sin(phase);
    } else if (r < 0.52) {
      [x, y, z] = boxEdge(rng, hw, yb, yt, hd);
      x += jitter(rng, 0.012);
      y += jitter(rng, 0.012);
    } else if (r < 0.95) {
      const face = rng();
      if (face < 0.75) {
        do {
          x = jitter(rng, hw);
          y = yb + rng() * (yt - yb);
        } while (keyhole(x, y));
        z = rng() < 0.75 ? hd : -hd;
      } else if (face < 0.9) {
        x = rng() < 0.5 ? -hw : hw;
        y = yb + rng() * (yt - yb);
        z = jitter(rng, hd);
      } else {
        y = rng() < 0.5 ? yb : yt;
        x = jitter(rng, hw);
        z = jitter(rng, hd);
      }
    } else {
      const theta = rng() * Math.PI * 2;
      x = 0.19 * Math.cos(theta);
      y = -0.38 + 0.19 * Math.sin(theta);
      z = hd + 0.02;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

function unit(rng: Rng): [number, number, number] {
  const u = rng() * 2 - 1;
  const theta = rng() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(theta), u, s * Math.sin(theta)];
}

function globe(count: number, rng: Rng): Float32Array {
  const out = new Float32Array(count * 3);
  const radius = 1.25;
  const arcs: Array<[[number, number, number], [number, number, number], number]> = [];
  while (arcs.length < 16) {
    const a = unit(rng);
    const b = unit(rng);
    const omega = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    if (omega > 0.7 && omega < 2.4) arcs.push([a, b, omega]);
  }
  const latitudes = [-60, -30, 0, 30, 60].map((value) => (value * Math.PI) / 180);
  for (let i = 0; i < count; i += 1) {
    const r = rng();
    let x: number, y: number, z: number;
    if (r < 0.4) {
      let lat: number, lon: number;
      if (rng() < 0.45) {
        lat = latitudes[Math.floor(rng() * latitudes.length)]!;
        lon = rng() * Math.PI * 2;
      } else {
        lon = Math.floor(rng() * 12) * (Math.PI / 6);
        lat = (rng() - 0.5) * Math.PI;
      }
      x = radius * Math.cos(lat) * Math.cos(lon);
      y = radius * Math.sin(lat);
      z = radius * Math.cos(lat) * Math.sin(lon);
    } else if (r < 0.68) {
      [x, y, z] = unit(rng).map((value) => value * radius) as [number, number, number];
    } else {
      const [a, b, omega] = arcs[Math.floor(rng() * arcs.length)]!;
      const t = rng();
      const sa = Math.sin((1 - t) * omega) / Math.sin(omega);
      const sb = Math.sin(t * omega) / Math.sin(omega);
      const lift = radius * (1 + 0.32 * Math.sin(Math.PI * t));
      x = (sa * a[0] + sb * b[0]) * lift;
      y = (sa * a[1] + sb * b[1]) * lift;
      z = (sa * a[2] + sb * b[2]) * lift;
    }
    out[i * 3] = x + jitter(rng, 0.012);
    out[i * 3 + 1] = y + jitter(rng, 0.012);
    out[i * 3 + 2] = z + jitter(rng, 0.012);
  }
  return out;
}

function blocks(count: number, rng: Rng): Float32Array {
  const out = new Float32Array(count * 3);
  const centers = [-1.62, -0.54, 0.54, 1.62];
  const heights = [0.18, -0.12, 0.14, -0.16];
  const s = 0.34;
  const scale = 0.72;
  for (let i = 0; i < count; i += 1) {
    const r = rng();
    const c = Math.floor(rng() * 4);
    const cx = centers[c]!;
    const cy = heights[c]!;
    let x: number, y: number, z: number;
    if (r < 0.55) {
      [x, y, z] = boxEdge(rng, s, -s, s, s);
      x += cx;
      y += cy;
    } else if (r < 0.85) {
      const axis = Math.floor(rng() * 3);
      const side = rng() < 0.5 ? -s : s;
      const u = jitter(rng, s);
      const v = jitter(rng, s);
      [x, y, z] = axis === 0 ? [side, u, v] : axis === 1 ? [u, side, v] : [u, v, side];
      x += cx;
      y += cy;
    } else {
      const k = Math.floor(rng() * 3);
      let t = rng();
      if (Math.floor(t * 10) % 2 === 1) t = Math.max(0, t - 0.1);
      const ax = centers[k]! + s, ay = heights[k]!;
      const bx = centers[k + 1]! - s, by = heights[k + 1]!;
      x = ax + (bx - ax) * t;
      y = ay + (by - ay) * t;
      z = jitter(rng, 0.02);
    }
    out[i * 3] = x * scale;
    out[i * 3 + 1] = y * scale;
    out[i * 3 + 2] = z * scale;
  }
  return out;
}

function fingerprint(count: number, rng: Rng): Float32Array {
  const out = new Float32Array(count * 3);
  const ridges = 10;
  // Per-ridge gaps make it read as a print rather than a target.
  const gaps = Array.from({ length: ridges }, () => [rng() * Math.PI * 2, 0.25 + rng() * 0.45] as const);
  for (let i = 0; i < count; i += 1) {
    const k = 1 + Math.floor(rng() * ridges);
    const radius = 0.12 + k * 0.125;
    let theta: number;
    let guard = 0;
    do {
      theta = rng() * Math.PI * 2;
      guard += 1;
      const [gapAt, gapSize] = gaps[k - 1]!;
      const distance = Math.abs(((theta - gapAt + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const bottomGap = theta > Math.PI * 1.32 && theta < Math.PI * 1.68 && k > 3;
      if (distance > gapSize && !bottomGap) break;
    } while (guard < 20);
    const x = radius * 0.82 * Math.cos(theta);
    const y = radius * 1.08 * Math.sin(theta) + 0.08;
    const z = 0.28 * Math.max(0, 1 - (radius / 1.4) ** 2);
    out[i * 3] = x + jitter(rng, 0.014);
    out[i * 3 + 1] = y + jitter(rng, 0.014);
    out[i * 3 + 2] = z + jitter(rng, 0.03);
  }
  return out;
}

function envelope(count: number, rng: Rng): Float32Array {
  const out = new Float32Array(count * 3);
  const hw = 1.15, hh = 0.72;
  const lines = [
    polyline([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]]),
    polyline([[-hw, hh], [0, 0.02], [hw, hh]]),
    polyline([[-hw, -hh], [-0.32, 0.12]]),
    polyline([[hw, -hh], [0.32, 0.12]]),
  ];
  const weights = [0.42, 0.28, 0.08, 0.08];
  for (let i = 0; i < count; i += 1) {
    const r = rng();
    let x: number, y: number, z: number;
    if (r < 0.86) {
      let pick = rng() * 0.86;
      let index = 0;
      while (index < weights.length - 1 && pick > weights[index]!) {
        pick -= weights[index]!;
        index += 1;
      }
      [x, y] = onLine(lines[index]!, rng());
      x += jitter(rng, 0.02);
      y += jitter(rng, 0.02);
      z = jitter(rng, 0.06);
    } else {
      // alert badge on the corner
      const theta = rng() * Math.PI * 2;
      const radius = 0.3 * Math.sqrt(rng());
      x = hw - 0.1 + radius * Math.cos(theta);
      y = hh + 0.05 + radius * Math.sin(theta);
      z = 0.12;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y - 0.05;
    out[i * 3 + 2] = z;
  }
  return out;
}

function tubePoint(rng: Rng, cx: number, cy: number, dx: number, dy: number, radius: number): [number, number, number] {
  const phase = rng() * Math.PI * 2;
  // offset perpendicular to the tube direction (in-plane normal and z)
  const nx = -dy, ny = dx;
  return [cx + nx * radius * Math.cos(phase), cy + ny * radius * Math.cos(phase), radius * Math.sin(phase)];
}

function key(count: number, rng: Rng): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const r = rng();
    let point: [number, number, number];
    if (r < 0.42) {
      const theta = rng() * Math.PI * 2;
      const cx = -0.78 + 0.44 * Math.cos(theta);
      const cy = 0.44 * Math.sin(theta);
      point = tubePoint(rng, cx, cy, -Math.sin(theta), Math.cos(theta), 0.12);
    } else if (r < 0.8) {
      point = tubePoint(rng, -0.34 + rng() * 1.6, 0, 1, 0, 0.1);
    } else {
      const tooth = rng() < 0.5 ? 0.82 : 1.1;
      point = tubePoint(rng, tooth, -rng() * 0.34, 0, 1, 0.08);
    }
    out[i * 3] = point[0] * 0.95;
    out[i * 3 + 1] = point[1] * 0.95;
    out[i * 3 + 2] = point[2];
  }
  return out;
}

function server(count: number, rng: Rng): Float32Array {
  const out = new Float32Array(count * 3);
  const levels = [-0.68, 0, 0.68];
  const hx = 1.05, hy = 0.24, hz = 0.45;
  for (let i = 0; i < count; i += 1) {
    const r = rng();
    const cy = levels[Math.floor(rng() * 3)]!;
    let x: number, y: number, z: number;
    if (r < 0.5) {
      [x, y, z] = boxEdge(rng, hx, -hy, hy, hz);
      y += cy;
    } else if (r < 0.88) {
      x = jitter(rng, hx);
      y = cy + jitter(rng, hy);
      z = rng() < 0.7 ? hz : -hz;
    } else {
      // status LEDs on the front panel
      const led = Math.floor(rng() * 3);
      const theta = rng() * Math.PI * 2;
      x = 0.62 + led * 0.14 + 0.04 * Math.cos(theta);
      y = cy + 0.04 * Math.sin(theta);
      z = hz + 0.02;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

/** A tubular trefoil sampled in a local frame, so the knot has real depth rather than a flat outline. */
function torusKnot(count: number, rng: Rng): Float32Array {
  const out = new Float32Array(count * 3);
  const curve = (t: number): [number, number, number] => [
    (2 + Math.cos(3 * t)) * Math.cos(2 * t) * 0.36,
    (2 + Math.cos(3 * t)) * Math.sin(2 * t) * 0.36,
    Math.sin(3 * t) * 0.48,
  ];
  for (let i = 0; i < count; i += 1) {
    const t = rng() * Math.PI * 2;
    const p = curve(t), next = curve(t + 0.001);
    let tx = next[0] - p[0], ty = next[1] - p[1], tz = next[2] - p[2];
    const len = Math.hypot(tx, ty, tz);
    tx /= len; ty /= len; tz /= len;
    const normalLen = Math.hypot(tx, ty) || 1;
    const nx = -ty / normalLen, ny = tx / normalLen;
    const bx = -tz * ny, by = tz * nx, bz = tx * ny - ty * nx;
    const angle = rng() * Math.PI * 2;
    const a = Math.cos(angle) * 0.095, b = Math.sin(angle) * 0.095;
    out.set([p[0] + nx * a + bx * b, p[1] + ny * a + by * b, p[2] + bz * b], i * 3);
  }
  return out;
}

/** Paired helical strands and cross links: a compact model of a connected evidence chain. */
function helix(count: number, rng: Rng): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const rung = rng() < 0.22;
    const t = rung ? Math.floor(rng() * 22) / 21 : rng();
    const angle = t * Math.PI * 4;
    const radius = rung ? (rng() * 2 - 1) * 0.66 : (rng() < 0.5 ? -1 : 1) * 0.66;
    out.set([Math.cos(angle) * radius + jitter(rng, 0.045), (t - 0.5) * 2.25 + jitter(rng, 0.045), Math.sin(angle) * radius + jitter(rng, 0.045)], i * 3);
  }
  return out;
}

/** Icosahedral network: rounded nodes connected by volumetric evidence filaments. */
function nexus(count: number, rng: Rng): Float32Array {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw: Array<[number, number, number]> = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) raw.push([0, a, b * phi], [a, b * phi, 0], [b * phi, 0, a]);
  const vertices = raw.map(([x, y, z]) => [x, y, z].map((v) => v * 1.12 / Math.hypot(x, y, z)) as [number, number, number]);
  const edges: Array<[number, number]> = [];
  raw.forEach((a, i) => raw.forEach((b, j) => { if (j > i && Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - 2) < 0.001) edges.push([i, j]); }));
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    if (rng() < 0.4) {
      const p = vertices[Math.floor(rng() * vertices.length)]!;
      const angle = rng() * Math.PI * 2, z = rng() * 2 - 1, r = Math.sqrt(1 - z * z) * 0.12;
      out.set([p[0] + r * Math.cos(angle), p[1] + r * Math.sin(angle), p[2] + z * 0.12], i * 3);
    } else {
      const [a, b] = edges[Math.floor(rng() * edges.length)]!;
      const start = vertices[a]!, end = vertices[b]!, t = rng();
      out.set(start.map((v, axis) => v + (end[axis]! - v) * t + jitter(rng, 0.025)), i * 3);
    }
  }
  return out;
}

export function sampleShape(name: ShapeName, count: number, seed: number): Float32Array {
  const rng = seeded(seed);
  switch (name) {
    case "torus-knot":
      return torusKnot(count, rng);
    case "helix":
      return helix(count, rng);
    case "nexus":
      return nexus(count, rng);
    case "shield":
      return shield(count, rng);
    case "lock":
      return lock(count, rng);
    case "globe":
      return globe(count, rng);
    case "fingerprint":
      return fingerprint(count, rng);
    case "envelope":
      return envelope(count, rng);
    case "key":
      return key(count, rng);
    case "server":
      return server(count, rng);
    default:
      return blocks(count, rng);
  }
}
