import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  h.box(0.32, 0.44, 0.022, "woodLight", { z: back + 0.011 });
  h.box(0.29, 0.41, 0.008, "paper", { y: 0.015, z: back + 0.027 });
  const sun = h.cylinder(0.055, 0.055, 0.01, "fabricTerracotta", { x: -0.055, y: 0.285, z: back + 0.037 });
  sun.rotation.x = Math.PI / 2;
  const slope = h.box(0.19, 0.13, 0.01, "fabricSage", { x: 0.04, y: 0.065, z: back + 0.038 });
  slope.rotation.z = 0.55;
  h.box(0.18, 0.065, 0.01, "leafDark", { x: 0.04, y: 0.025, z: back + 0.049 });
}
