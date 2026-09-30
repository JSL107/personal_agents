import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  h.box(0.38, 0.44, 0.03, "woodDark", { z: back + 0.015 });
  h.box(0.34, 0.39, 0.012, "paper", { y: 0.025, z: back + 0.037 });
  h.box(0.18, 0.15, 0.012, "screenDark", { x: -0.07, y: 0.03, z: back + 0.049 });
  h.box(0.1, 0.14, 0.012, "fabricTerracotta", { x: 0.12, y: 0.03, z: back + 0.049 });
  h.box(0.16, 0.06, 0.012, "fabricSage", { x: -0.04, y: 0.23, z: back + 0.049 });
  h.box(0.075, 0.055, 0.012, "wallTrim", { x: 0.02, y: 0.33, z: back + 0.049 });
}
