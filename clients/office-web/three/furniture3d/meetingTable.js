// 회의 탁자 — 가로 1칸 × 세로 2칸. 둥근 모서리 상판과 굵은 다리 넷.
import { SCALE } from "../style.js";

export const spec = { footprint: [1, 2], height: 0.6 };

export function build(h) {
  const top = SCALE.deskTop;
  h.box(0.9, 0.07, 1.84, "woodLight", { y: top - 0.07 });
  for (const x of [-0.34, 0.34]) {
    for (const z of [-0.78, 0.78]) {
      h.box(0.08, top - 0.07, 0.08, "woodMid", { x, z });
    }
  }
  h.box(0.2, 0.02, 0.28, "paper", { x: -0.15, y: top, z: -0.4 });
  h.cylinder(0.05, 0.04, 0.08, "potCream", { x: 0.18, y: top, z: 0.3 });
}
