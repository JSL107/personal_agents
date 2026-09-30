import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  h.box(0.72, 0.4, 0.045, "metalDark", { y: 0.025, z: back + 0.023 });
  h.box(0.66, 0.32, 0.012, "screenDark", { y: 0.067, z: back + 0.051 });
  h.box(0.56, 0.015, 0.012, "screenGlow", { x: 0.01, y: 0.105, z: back + 0.065 });
  h.box(0.014, 0.2, 0.012, "screenGlow", { x: -0.26, y: 0.105, z: back + 0.065 });
  for (const [x, y] of [[-0.21, 0.16], [-0.12, 0.23], [-0.03, 0.19], [0.06, 0.27], [0.16, 0.26], [0.27, 0.33]]) {
    h.box(0.045, 0.012, 0.012, "screenGlow", { x, y, z: back + 0.065 });
  }
}
