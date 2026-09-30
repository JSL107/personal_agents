// 검은 사무용 의자 — 다섯 갈래 받침과 팔걸이, 정면 +z.
import { SCALE } from "../style.js";

export const spec = { footprint: [1, 1], height: 0.72 };

export function build(h) {
  const seat = SCALE.chairSeat;
  for (let index = 0; index < 5; index += 1) {
    const angle = index * Math.PI * 2 / 5;
    h.box(0.045, 0.035, 0.24, "chairBlack", {
      x: Math.sin(angle) * 0.1, y: 0.03, z: Math.cos(angle) * 0.1, rotY: angle,
    });
    h.sphere(0.035, "chairBlack", {
      x: Math.sin(angle) * 0.2, z: Math.cos(angle) * 0.2,
    }, 0.7);
  }
  h.cylinder(0.035, 0.035, seat - 0.08, "metalDark", { y: 0.04 });
  h.box(0.44, 0.06, 0.42, "chairBlack", { y: seat - 0.06 });
  h.box(0.42, 0.36, 0.08, "chairBlack", { y: seat, z: -0.2 });
  for (const x of [-0.25, 0.25]) {
    h.box(0.035, 0.12, 0.035, "metalDark", { x, y: seat - 0.03 });
    h.box(0.065, 0.045, 0.3, "chairBlack", { x, y: seat + 0.09 });
  }
}
