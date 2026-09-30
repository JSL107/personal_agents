import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  h.box(0.78, 0.43, 0.035, "metalDark", { y: 0.01, z: back + 0.018 });
  h.box(0.73, 0.37, 0.012, "paper", { y: 0.04, z: back + 0.041 });
  h.box(0.78, 0.025, 0.075, "metalLight", { y: 0.01, z: back + 0.057 });
  h.box(0.15, 0.015, 0.015, "metalDark", { x: -0.23, y: 0.18, z: back + 0.055, rotY: -0.3 });
  h.box(0.13, 0.018, 0.015, "metalDark", { x: -0.07, y: 0.27, z: back + 0.055 });
  for (const [x, height] of [[0.1, 0.07], [0.17, 0.12], [0.24, 0.16], [0.31, 0.21]]) {
    h.box(0.035, height, 0.012, "bookBlue", { x, y: 0.06, z: back + 0.055 });
  }
  for (const [x, color] of [[-0.23, "bookRed"], [-0.09, "screenDark"], [0.07, "bookBlue"]]) {
    h.box(0.08, 0.015, 0.018, color, { x, y: 0.024, z: back + 0.101 });
  }
}
