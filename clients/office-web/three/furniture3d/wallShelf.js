import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  h.box(0.78, 0.43, 0.025, "woodMid", { y: 0.01, z: back + 0.013 });
  h.box(0.74, 0.05, 0.105, "woodLight", { y: 0.015, z: back + 0.078 });
  h.box(0.73, 0.028, 0.09, "woodLight", { y: 0.39, z: back + 0.07 });
  h.cylinder(0.055, 0.04, 0.09, "potCream", { x: -0.27, y: 0.067, z: back + 0.07 });
  h.sphere(0.065, "leafDark", { x: -0.27, y: 0.14, z: back + 0.07 });
  for (const [x, color, height] of [[-0.1, "woodDark", 0.24], [0, "bookRed", 0.27], [0.12, "bookBlue", 0.28], [0.25, "paper", 0.2]]) {
    h.box(0.075, height, 0.065, color, { x, y: 0.065, z: back + 0.07 });
  }
}
