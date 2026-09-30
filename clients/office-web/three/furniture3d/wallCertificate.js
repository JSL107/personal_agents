import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  h.box(0.46, 0.44, 0.04, "woodDark", { z: back + 0.02 });
  h.box(0.4, 0.38, 0.01, "woodLight", { y: 0.03, z: back + 0.046 });
  h.box(0.34, 0.32, 0.01, "paper", { y: 0.06, z: back + 0.057 });
  h.box(0.23, 0.018, 0.01, "wallTrim", { y: 0.32, z: back + 0.068 });
  h.box(0.15, 0.05, 0.01, "wallTrim", { y: 0.22, z: back + 0.068 });
  h.cylinder(0.06, 0.06, 0.012, "woodMid", { y: 0.13, z: back + 0.071 }).rotation.x = Math.PI / 2;
  h.box(0.03, 0.08, 0.012, "bookBlue", { x: 0.018, y: 0.025, z: back + 0.075 });
}
