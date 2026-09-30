// 원목 책상·오른쪽 서랍·검은 키보드와 마우스. 정면은 +z.
import { SCALE } from "../style.js";

export const spec = { footprint: [1, 1], height: 0.9 };

export function build(h) {
  const top = SCALE.deskTop;
  h.box(0.92, 0.06, 0.72, "woodLight", { y: top - 0.06 });
  h.box(0.07, top - 0.06, 0.62, "woodMid", { x: -0.39 });
  h.box(0.27, top - 0.06, 0.62, "woodMid", { x: 0.31 });
  h.box(0.74, 0.16, 0.04, "woodMid", { y: top - 0.22, z: -0.29 });
  for (const y of [0.04, 0.22]) {
    h.box(0.23, 0.16, 0.025, "woodLight", { x: 0.31, y, z: 0.32 });
    h.box(0.085, 0.02, 0.02, "metalLight", { x: 0.31, y: y + 0.1, z: 0.342 });
  }
  h.box(0.2, 0.02, 0.12, "chairBlack", { y: top, z: -0.17 });
  h.box(0.04, 0.1, 0.04, "chairBlack", { y: top + 0.02, z: -0.2 });
  h.box(0.46, 0.28, 0.05, "screenDark", { y: top + 0.1, z: -0.2 });
  h.box(0.4, 0.22, 0.01, "screenGlow", { y: top + 0.13, z: -0.17 });
  h.box(0.4, 0.025, 0.14, "chairBlack", { x: -0.07, y: top, z: 0.15 });
  for (const z of [0.105, 0.145, 0.185]) {
    h.box(0.34, 0.006, 0.013, "metalDark", { x: -0.07, y: top + 0.025, z });
  }
  h.sphere(0.047, "chairBlack", { x: 0.25, y: top, z: 0.15 }, 0.45);
}
