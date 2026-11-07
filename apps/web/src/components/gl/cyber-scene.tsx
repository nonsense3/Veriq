"use client";

import type { RiskClass } from "@veriq/contracts";
import { sampleShape, seeded, type ShapeName } from "./shapes";
import { deviceTier, rgb, useGL } from "./use-gl";

export const CYBER_PALETTES: Record<"signal" | RiskClass, { a: string; b: string; threat: string }> = {
  signal: { a: "#4a68ff", b: "#e9edff", threat: "#ff4d57" },
  low_risk: { a: "#34d399", b: "#e3fbef", threat: "#ff4d57" },
  suspicious: { a: "#f5b942", b: "#fff3da", threat: "#ff4d57" },
  high_risk: { a: "#ff4d57", b: "#ffe1e3", threat: "#ffffff" },
  confirmed_malicious: { a: "#d4213a", b: "#ffd0d6", threat: "#ffffff" },
  inconclusive: { a: "#8b92a5", b: "#eef0f6", threat: "#ff4d57" },
};

type Props = {
  shapes: ShapeName[];
  /** cycle: morph on a timer · scroll: morph with scroll position · static: hold the first shape */
  mode?: "cycle" | "scroll" | "static";
  palette?: keyof typeof CYBER_PALETTES;
  /** Fraction of particles flagged as threats; the scan beam reveals them in the threat colour. */
  threat?: number;
  align?: "center" | "right" | "far-right" | "upper-right" | "top";
  density?: number;
  size?: number;
  /** Tilted 3D orbit rings carrying travelling data packets. */
  orbits?: boolean;
  className?: string;
};

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Original particle forms for a security product: shield, padlock, network globe and ledger blocks.
 * Particles morph between forms through a burst, drift with a gentle field, scatter from the pointer,
 * and a scan beam sweeps the form, lighting up particles and exposing "threat" points.
 */
export function CyberScene({ shapes, mode = "cycle", palette = "signal", threat = 0.03, align = "center", density = 1, size = 1, orbits = true, className = "gl-host" }: Props) {
  const key = `${shapes.join("-")}|${mode}|${palette}|${threat}|${align}|${density}|${size}|${orbits}`;
  const { ref, failed } = useGL((THREE, renderer, host) => {
    const colors = CYBER_PALETTES[palette];
    const tier = deviceTier();
    const count = Math.round((tier === "low" ? 1600 : tier === "mid" ? 4500 : 10000) * density);
    const list = [0, 1, 2].map((index) => shapes[Math.min(index, shapes.length - 1)]!);
    const n = mode === "static" ? 1 : Math.min(3, shapes.length);
    const showOrbits = orbits && tier !== "low";

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(sampleShape(list[0]!, count, 11), 3));
    geometry.setAttribute("aP1", new THREE.BufferAttribute(sampleShape(list[1]!, count, 23), 3));
    geometry.setAttribute("aP2", new THREE.BufferAttribute(sampleShape(list[2]!, count, 37), 3));
    const random = new Float32Array(count * 4);
    const rng = seeded(5);
    for (let i = 0; i < count; i += 1) {
      random[i * 4] = rng();
      random[i * 4 + 1] = rng();
      random[i * 4 + 2] = rng() < threat ? 1 : 0;
      random[i * 4 + 3] = rng();
    }
    geometry.setAttribute("aRand", new THREE.BufferAttribute(random, 4));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);

    const uniforms = {
      uM: { value: 0 },
      uN: { value: n },
      uWrap: { value: mode === "cycle" ? 1 : 0 },
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector3(99, 99, 0) },
      uPointerOn: { value: 0 },
      uScan: { value: 0 },
      uPixel: { value: renderer.getPixelRatio() },
      uPointScale: { value: 1 },
      uA: { value: new THREE.Vector3(...rgb(colors.a)) },
      uB: { value: new THREE.Vector3(...rgb(colors.b)) },
      uT: { value: new THREE.Vector3(...rgb(colors.threat)) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aP1; attribute vec3 aP2; attribute vec4 aRand;
        uniform float uM; uniform float uN; uniform float uWrap; uniform float uTime; uniform vec3 uPointer; uniform float uPointerOn; uniform float uScan; uniform float uPixel; uniform float uPointScale;
        varying float vAlpha; varying float vScan; varying float vThreat; varying float vTone;
        void main() {
          // Each particle crosses to the next form at its own moment. Blending whole shapes by a
          // shared weight left the form a melted hybrid halfway through, which is what looked broken
          // when a scroll stopped mid-morph; staggering reads as a dissolve and always shows a shape.
          float m = uM;
          m = uWrap > 0.5 ? mod(m + uN, uN) : clamp(m, 0.0, uN - 1.0);
          float i = floor(m);
          float j = uWrap > 0.5 ? mod(i + 1.0, uN) : min(i + 1.0, uN - 1.0);
          vec3 from = i < 0.5 ? position : (i < 1.5 ? aP1 : aP2);
          vec3 to = j < 0.5 ? position : (j < 1.5 ? aP1 : aP2);
          float k = smoothstep(0.1 + aRand.x * 0.35, 0.6 + aRand.x * 0.35, fract(m));
          vec3 p = mix(from, to, k);
          float burst = sin(k * 3.14159265);
          float ph = aRand.y * 6.2831;
          vec3 drift = vec3(
            sin(uTime * 0.7 + ph + p.y * 2.1),
            cos(uTime * 0.6 + ph * 1.3 + p.x * 1.7),
            sin(uTime * 0.5 + ph * 0.7 + p.z * 2.3));
          p += drift * (0.012 + burst * 0.14 * (0.4 + aRand.x));
          vec4 world = modelMatrix * vec4(p, 1.0);
          vec2 d = world.xy - uPointer.xy;
          float push = uPointerOn * (1.0 - smoothstep(0.0, 1.5, length(d)));
          world.xy += normalize(d + 1e-5) * push * 0.8;
          world.z += push * 0.6;
          vec4 mv = viewMatrix * world;
          gl_Position = projectionMatrix * mv;
          vScan = 1.0 - smoothstep(0.0, 0.3, abs(world.y - uScan));
          vThreat = aRand.z;
          vTone = aRand.w;
          vAlpha = (0.42 + 0.58 * aRand.w) * (1.0 - burst * 0.35);
          gl_PointSize = (1.1 + aRand.x * 2.0 + vScan * 1.8 + push * 1.5) * uPixel * uPointScale * (12.0 / -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uA; uniform vec3 uB; uniform vec3 uT;
        varying float vAlpha; varying float vScan; varying float vThreat; varying float vTone;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha * (1.0 + vScan * 0.6);
          vec3 c = vTone > 0.72 ? uB : uA;
          c = mix(c, vec3(1.0), vScan * 0.55);
          c = mix(c, uT, vThreat * (0.22 + 0.78 * vScan));
          gl_FragColor = vec4(c * a, a);
        }`,
    });

    const points = new THREE.Points(geometry, material);
    const group = new THREE.Group();
    group.add(points);

    // One static GPU buffer supplies a sparse depth field; weak devices omit this draw call.
    const dustGeometry = new THREE.BufferGeometry();
    const dustMaterial = new THREE.PointsMaterial({ color: colors.a, size: 0.018, transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending });
    const dustPositions = new Float32Array((showOrbits ? (tier === "high" ? 260 : 100) : 0) * 3);
    for (let i = 0; i < dustPositions.length; i += 3) {
      const azimuth = rng() * Math.PI * 2, elevation = rng() * 2 - 1;
      const radius = 1.65 + rng() * 0.45;
      const equator = Math.sqrt(1 - elevation * elevation);
      dustPositions.set([radius * equator * Math.cos(azimuth), radius * elevation, radius * equator * Math.sin(azimuth)], i);
    }
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    const dust = new THREE.Points(dustGeometry, dustMaterial);
    if (showOrbits) group.add(dust);
    const volumetric = shapes.some((shape) => ["torus-knot", "helix", "nexus"].includes(shape));

    // Orbit rings: three tilted 3D ellipses, each carrying bright data packets that travel along it.
    const ringMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uA: uniforms.uA, uB: uniforms.uB },
      vertexShader: /* glsl */ `
        attribute float aU; attribute float aSpeed; varying float vU; varying float vSpeed;
        void main() { vU = aU; vSpeed = aSpeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uA; uniform vec3 uB; varying float vU; varying float vSpeed;
        void main() {
          float head = fract(vU - uTime * vSpeed);
          float packet = smoothstep(0.9, 1.0, head) + smoothstep(0.4, 0.5, head) * (1.0 - smoothstep(0.5, 0.52, head)) * 0.6;
          float a = 0.08 + packet * 0.9;
          vec3 c = mix(uA, uB, packet);
          gl_FragColor = vec4(c * a, a);
        }`,
    });
    const rings: InstanceType<typeof THREE.LineLoop>[] = [];
    if (showOrbits) {
      const tilts: Array<[number, number, number, number]> = [[1.85, 0.5, 1.3, 0.09], [1.7, -0.9, 0.4, -0.07], [2.0, 0.2, -0.6, 0.05]];
      for (const [radius, tiltX, tiltZ, speed] of tilts) {
        const segments = 256;
        const positions = new Float32Array(segments * 3);
        const along = new Float32Array(segments);
        const speeds = new Float32Array(segments).fill(speed);
        for (let i = 0; i < segments; i += 1) {
          const angle = (i / segments) * Math.PI * 2;
          positions[i * 3] = Math.cos(angle) * radius;
          positions[i * 3 + 1] = Math.sin(angle) * radius * 0.42;
          positions[i * 3 + 2] = Math.sin(angle) * radius * 0.2;
          along[i] = i / segments;
        }
        const ringGeometry = new THREE.BufferGeometry();
        ringGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        ringGeometry.setAttribute("aU", new THREE.BufferAttribute(along, 1));
        ringGeometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
        const ring = new THREE.LineLoop(ringGeometry, ringMaterial);
        ring.rotation.set(tiltX, 0, tiltZ);
        group.add(ring);
        rings.push(ring);
      }
    }
    const scene = new THREE.Scene();
    scene.add(group);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.z = 11;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const pointerNdc = new THREE.Vector2(9, 9);
    const hit = new THREE.Vector3();
    let inside = false;
    let parallaxX = 0;
    let parallaxY = 0;
    let scale = 1;

    const morphAt = (time: number) => {
      if (n === 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
      if (mode === "scroll") {
        const rect = host.getBoundingClientRect();
        const progress = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / (window.innerHeight + rect.height)));
        // Each shape holds for most of its scroll segment; the morph happens in a short band between them,
        // so the form is never left mid-burst when scrolling stops.
        return Math.min(n - 1, Math.floor(progress * n));
      }
      const phase = time / 6.5;
      return (Math.floor(phase) % n) + smooth(0.82, 1, phase - Math.floor(phase));
    };

    return {
      resize(width, height) {
        const aspect = width / height;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        const halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
        const halfW = halfH * aspect;
        // Each layout keeps the form inside its own region of the stage so it never runs under the content.
        const wide = aspect > 1.25;
        const layouts: Record<NonNullable<Props["align"]>, { x: number; y: number; h: number; w: number }> = {
          center: { x: 0, y: 0, h: 0.66, w: 0.66 },
          right: wide ? { x: 0.46, y: 0.08, h: 0.58, w: 0.3 } : { x: 0, y: 0.3, h: 0.42, w: 0.6 },
          "far-right": wide ? { x: 0.72, y: 0.2, h: 0.4, w: 0.2 } : { x: 0, y: 0.38, h: 0.34, w: 0.6 },
          "upper-right": wide ? { x: 0.58, y: 0.4, h: 0.32, w: 0.26 } : { x: 0, y: 0.45, h: 0.28, w: 0.55 },
          top: { x: 0, y: 0.5, h: 0.36, w: 0.5 },
        };
        const layout = layouts[align];
        scale = (Math.min(halfH * layout.h, halfW * layout.w) / 1.4) * size;
        group.scale.setScalar(scale);
        // Dedicated artwork regions can give the main form more presence without enlarging
        // the surrounding orbit/dust envelope into adjacent copy. Recompute on container resize,
        // including orientation changes; small phone cells keep a more conservative fit.
        const shortSide = Math.min(width, height);
        const formScale = align === "center" ? 1.25 + 0.25 * smooth(120, 400, shortSide) : 1;
        points.scale.setScalar(formScale);
        group.position.set(halfW * layout.x, halfH * layout.y, 0);
        uniforms.uPixel.value = renderer.getPixelRatio();
        // Dot size follows the illustration's CSS size, independently of the device pixel ratio.
        uniforms.uPointScale.value = 0.7 + 0.4 * smooth(100, 420, shortSide);
      },
      pointer(x, y) {
        inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
        pointerNdc.set(x * 2 - 1, -(y * 2 - 1));
      },
      frame(time, delta) {
        const target = morphAt(time);
        // First appearance is a complete form; subsequent scroll changes settle to a complete form
        // even if the user stops scrolling halfway between sections.
        if (mode !== "scroll" || time === 0) uniforms.uM.value = target;
        else {
          uniforms.uM.value += (target - uniforms.uM.value) * (1 - Math.exp(-12 * delta));
          if (Math.abs(target - uniforms.uM.value) < 0.001) uniforms.uM.value = target;
        }
        uniforms.uTime.value = time;
        if (inside) {
          raycaster.setFromCamera(pointerNdc, camera);
          if (raycaster.ray.intersectPlane(plane, hit)) uniforms.uPointer.value.copy(hit);
        }
        uniforms.uPointerOn.value += ((inside ? 1 : 0) - uniforms.uPointerOn.value) * 0.08;
        const span = scale * 1.7;
        uniforms.uScan.value = group.position.y + span * (1 - 2 * ((time * 0.16) % 1));
        parallaxX += ((inside ? pointerNdc.x : 0) - parallaxX) * 0.04;
        parallaxY += ((inside ? pointerNdc.y : 0) - parallaxY) * 0.04;
        points.rotation.y = (volumetric ? time * 0.13 : 0) + Math.sin(time * 0.28) * 0.55 + parallaxX * 0.35;
        points.rotation.x = Math.sin(time * 0.21) * 0.12 - parallaxY * 0.18;
        dust.rotation.y = -time * 0.035;
        dust.rotation.z = Math.sin(time * 0.1) * 0.12;
        ringMaterial.uniforms.uTime!.value = time;
        rings.forEach((ring, index) => {
          ring.rotation.y = time * (0.08 + index * 0.03) * (index % 2 ? -1 : 1) + parallaxX * 0.2;
        });
        renderer.render(scene, camera);
      },
      dispose() {
        geometry.dispose();
        material.dispose();
        rings.forEach((ring) => ring.geometry.dispose());
        ringMaterial.dispose();
        dustGeometry.dispose();
        dustMaterial.dispose();
      },
    };
  }, { sceneKey: key });

  return (
    <div className={className} data-scene={key} ref={ref}>
      {failed && <div className="gl-fallback" />}
    </div>
  );
}
