import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  h.box(0.72, 0.44, 0.035, "woodMid", { z: back + 0.018 });
  h.box(0.64, 0.36, 0.01, "fabricBlue", { x: 0, y: 0.04, z: back + 0.041 });
  h.box(0.64, 0.11, 0.012, "bookBlue", { y: 0.04, z: back + 0.05 });
  h.box(0.64, 0.075, 0.014, "leafDark", { y: 0.04, z: back + 0.059 });
  h.box(0.19, 0.14, 0.014, "leafDark", { x: -0.22, y: 0.16, z: back + 0.06 });
  h.box(0.16, 0.11, 0.014, "leafLight", { x: 0.22, y: 0.13, z: back + 0.06 });
  h.box(0.16, 0.025, 0.013, "paper", { x: -0.16, y: 0.31, z: back + 0.06 });
  h.box(0.09, 0.03, 0.013, "paper", { x: 0.19, y: 0.28, z: back + 0.06 });
}
