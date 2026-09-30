// 하부 수납장 위의 커피머신과 옆에 놓인 머그컵.
import { SCALE } from "../style.js";

export const spec = { footprint: [1, 1], height: 0.8 };

export function build(h) {
  const counter = SCALE.deskTop;
  h.box(0.82, counter - 0.04, 0.62, "woodLight", { y: 0.02 });
  h.box(0.88, 0.04, 0.68, "woodMid", { y: counter - 0.04 });
  h.box(0.02, 0.26, 0.02, "woodDark", { y: 0.08, z: 0.32 });
  for (const x of [-0.12, 0.12]) {
    h.box(0.025, 0.08, 0.018, "metalLight", { x, y: 0.19, z: 0.32 });
  }
  h.box(0.36, 0.3, 0.32, "cabinetCharcoal", { x: -0.18, y: counter, z: -0.11 });
  h.box(0.3, 0.04, 0.34, "screenDark", { x: -0.18, y: 0.76, z: -0.11 });
  h.box(0.23, 0.16, 0.015, "screenDark", { x: -0.18, y: 0.54, z: 0.06 });
  h.box(0.09, 0.05, 0.02, "metalLight", { x: -0.18, y: 0.7, z: 0.07 });
  h.cylinder(0.075, 0.065, 0.1, "paper", { x: -0.18, y: counter, z: 0.13 });
  h.cylinder(0.09, 0.075, 0.19, "paper", { x: 0.23, y: counter, z: -0.05 });
  h.cylinder(0.06, 0.06, 0.015, "screenDark", { x: 0.23, y: 0.65, z: -0.05 });
  h.box(0.035, 0.11, 0.035, "metalDark", { x: 0.34, y: 0.51, z: -0.05 });
}
