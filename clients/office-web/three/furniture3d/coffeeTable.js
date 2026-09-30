// 밝은 원목 상판과 네 다리의 낮은 직사각 테이블.
import { SCALE } from "../style.js";

export const spec = { footprint: [1, 1], height: 0.3 };

export function build(h) {
  const top = SCALE.chairSeat + 0.04;
  h.box(0.88, 0.06, 0.58, "woodLight", { y: top - 0.06 });
  h.box(0.82, 0.045, 0.05, "woodMid", { y: top - 0.105, z: 0.24 });
  for (const x of [-0.36, 0.36]) {
    for (const z of [-0.21, 0.21]) {
      h.box(0.07, top - 0.06, 0.07, "woodMid", { x, z });
    }
  }
}
