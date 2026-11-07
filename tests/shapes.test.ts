import { describe, expect, it } from "vitest";
import { sampleShape } from "../apps/web/src/components/gl/shapes";

describe("volumetric particle forms", () => {
  for (const shape of ["torus-knot", "helix", "nexus"] as const) {
    it(`${shape} produces deterministic finite 3D positions within the camera budget`, () => {
      const points = sampleShape(shape, 1600, 11);
      expect(points.length).toBe(4800);
      expect(points).toEqual(sampleShape(shape, 1600, 11));
      const extents = [0, 0, 0];
      for (let i = 0; i < points.length; i += 3) {
        const p = [points[i]!, points[i + 1]!, points[i + 2]!];
        expect(p.every(Number.isFinite)).toBe(true);
        expect(Math.hypot(...p)).toBeLessThan(1.45);
        p.forEach((value, axis) => { extents[axis] = Math.max(extents[axis]!, Math.abs(value)); });
      }
      expect(extents.every((extent) => extent > 0.3)).toBe(true);
      expect(sampleShape(shape, 0, 11).length).toBe(0);
    });
  }
});
