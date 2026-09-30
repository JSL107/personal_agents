// 원목 하부장, 짙은 싱크볼, 뒤쪽의 수전.
import { SCALE } from "../style.js";

export const spec = { footprint: [1, 1], height: 0.62 };

export function build(h) {
  const top = SCALE.deskTop;
  h.box(0.86, top - 0.04, 0.56, "woodLight", { y: 0.02 });
  h.box(0.91, 0.04, 0.62, "paper", { y: top - 0.04 });
  h.box(0.46, 0.018, 0.3, "metalDark", { y: top, z: -0.05 });
  h.box(0.37, 0.008, 0.22, "screenDark", { y: top + 0.018, z: -0.05 });
  h.cylinder(0.022, 0.022, 0.14, "metalLight", { x: 0.06, y: top, z: -0.23 });
  h.box(0.15, 0.025, 0.03, "metalLight", { x: -0.01, y: 0.59, z: -0.23 });
  h.box(0.02, 0.1, 0.02, "metalLight", { x: -0.08, y: 0.52, z: -0.23 });
  for (const x of [-0.11, 0.11]) {
    h.box(0.02, 0.08, 0.018, "metalLight", { x, y: 0.21, z: 0.29 });
  }
  h.box(0.02, 0.36, 0.018, "woodMid", { y: 0.05, z: 0.29 });
}
