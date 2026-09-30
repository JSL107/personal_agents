import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  h.box(0.42, 0.4, 0.025, "paper", { z: back + 0.013 });
  h.box(0.44, 0.045, 0.035, "metalDark", { y: 0.35, z: back + 0.018 });
  h.box(0.44, 0.055, 0.012, "fabricBlue", { y: 0.31, z: back + 0.04 });
  h.box(0.38, 0.012, 0.012, "metalLight", { y: 0.19, z: back + 0.04 });
  for (const x of [-0.11, 0, 0.11]) {
    h.box(0.012, 0.2, 0.012, "metalLight", { x, y: 0.07, z: back + 0.04 });
  }
  h.box(0.42, 0.025, 0.012, "wallTrim", { z: back + 0.04 });
  h.box(0.045, 0.025, 0.025, "screenDark", { y: 0.395, z: back + 0.02 });
}
