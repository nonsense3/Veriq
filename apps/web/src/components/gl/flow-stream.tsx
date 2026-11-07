"use client";

import { deviceTier, rgb, useGL } from "./use-gl";

/**
 * Liquid data stream: particles advected left→right through a slowly evolving, divergence-free flow,
 * drawn with persistent fading trails so they read as viscous liquid ribbons. A few particles are
 * threats (red); the pointer acts like a stone in the current and parts the flow around it.
 */
export function FlowStream({ className = "gl-host", threat = 0.04 }: { className?: string; threat?: number }) {
  const { ref, failed } = useGL(
    (THREE, renderer) => {
      renderer.autoClear = false;
      const small = window.innerWidth < 720;
      // Fewer, faster particles: long liquid streaks read better than a field of dots and stay out of the text.
      const count = deviceTier() === "low" ? 350 : small ? 650 : 1200;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const speed = new Float32Array(count);
      const blue = rgb("#4a68ff");
      const pale = rgb("#dfe5ff");
      const red = rgb("#ff4d57");
      let width = 16;
      let height = 9;
      const spawn = (i: number, anywhere: boolean) => {
        positions[i * 3] = anywhere ? (Math.random() - 0.5) * width : -width / 2 - Math.random() * 1.5;
        // Concentrate the current in the middle band, away from the headline and the incident list.
        positions[i * 3 + 1] = (Math.random() + Math.random() - 1) * height * 0.32;
        positions[i * 3 + 2] = 0;
      };
      for (let i = 0; i < count; i += 1) {
        spawn(i, true);
        const r = Math.random();
        const color = r < threat ? red : r < 0.75 ? blue : pale;
        colors.set(color, i * 3);
        speed[i] = 0.7 + Math.random() * 0.7;
      }
      const geometry = new THREE.BufferGeometry();
      const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", positionAttribute);
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
      const material = new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      const scene = new THREE.Scene();
      scene.add(new THREE.Points(geometry, material));
      const camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 10);
      camera.position.z = 5;

      // Full-screen translucent quad: fading the previous frame instead of clearing it leaves liquid trails.
      const fadeScene = new THREE.Scene();
      const fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        uniforms: { uColor: { value: new THREE.Vector3(...rgb("#07080c")) } },
        vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: "uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 0.045); }",
      }));
      fadeScene.add(fade);
      const fadeCamera = new THREE.Camera();
      const pointer = { x: 99, y: 99, on: 0 };
      let started = false;

      return {
        resize(w, h) {
          height = 9;
          width = height * (w / h);
          camera.left = -width / 2;
          camera.right = width / 2;
          camera.top = height / 2;
          camera.bottom = -height / 2;
          camera.updateProjectionMatrix();
          renderer.setClearColor(0x07080c, 1);
          renderer.clear();
          material.size = 1.8 * renderer.getPixelRatio();
        },
        pointer(x, y) {
          const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
          pointer.on = inside ? 1 : 0;
          pointer.x = (x - 0.5) * width;
          pointer.y = (0.5 - y) * height;
        },
        frame(time, delta) {
          const dt = Math.min(delta, 1 / 30);
          const t = time * 0.25;
          for (let i = 0; i < count; i += 1) {
            const o = i * 3;
            let x = positions[o]!;
            let y = positions[o + 1]!;
            // Stream function ψ(x, y, t); velocity = (∂ψ/∂y, −∂ψ/∂x) keeps the flow incompressible.
            let vx = 1.1 + 0.9 * Math.cos(y * 0.9 + t) * Math.cos(x * 0.35 - t * 0.7) + 0.4 * Math.cos(y * 1.9 - t * 1.3);
            let vy = 0.32 * Math.sin(y * 0.9 + t) * Math.sin(x * 0.35 - t * 0.7) + 0.35 * Math.sin(x * 0.6 + t);
            if (pointer.on) {
              const dx = x - pointer.x;
              const dy = y - pointer.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < 3) {
                const push = (3 - d2) * 1.6;
                vx += dx * push;
                vy += dy * push;
              }
            }
            x += vx * dt * speed[i]! * 2.2;
            y += vy * dt * speed[i]! * 2.2;
            if (x > width / 2 + 0.5 || Math.abs(y) > height / 2 + 0.5) spawn(i, false);
            else {
              positions[o] = x;
              positions[o + 1] = y;
            }
          }
          positionAttribute.needsUpdate = true;
          if (!started) {
            renderer.clear();
            started = true;
          }
          renderer.render(fadeScene, fadeCamera);
          renderer.render(scene, camera);
        },
        dispose() {
          geometry.dispose();
          material.dispose();
          fade.geometry.dispose();
          (fade.material as InstanceType<typeof THREE.ShaderMaterial>).dispose();
        },
      };
    },
    { maxDpr: 1.5 },
  );

  return <div className={className} ref={ref}>{failed && <div className="gl-fallback" />}</div>;
}
