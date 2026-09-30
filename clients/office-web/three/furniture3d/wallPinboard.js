import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  h.box(0.75, 0.4, 0.035, "woodLight", { y: 0.02, z: back + 0.018 });
  h.box(0.69, 0.34, 0.012, "wallTrim", { y: 0.05, z: back + 0.041 });
  for (const [x, y, color] of [
    [-0.23, 0.27, "paper"], [0.03, 0.23, "fabricBlue"], [0.23, 0.27, "bookGreen"],
    [-0.22, 0.09, "fabricTerracotta"], [0.04, 0.08, "fabricSage"], [0.23, 0.1, "fabricCream"],
  ]) {
    h.box(0.1, 0.09, 0.01, color, { x, y, z: back + 0.054 });
    h.sphere(0.009, "metalDark", { x, y: y + 0.065, z: back + 0.065 });
  }
}
