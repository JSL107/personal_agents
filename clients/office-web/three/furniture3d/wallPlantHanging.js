import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  h.box(0.06, 0.045, 0.025, "metalDark", { y: 0.415, z: back + 0.013 });
  for (const x of [-0.1, 0.1]) {
    const cord = h.box(0.01, 0.18, 0.012, "woodDark", { x, y: 0.25, z: back + 0.045 });
    cord.rotation.z = x < 0 ? -0.18 : 0.18;
  }
  const pot = h.cylinder(0.09, 0.065, 0.1, "potCream", { y: 0.16, z: back + 0.07 });
  pot.scale.z = 0.65;
  for (const [x, y] of [[-0.12, 0.18], [0, 0.23], [0.12, 0.18], [-0.14, 0.1], [0.15, 0.09]]) {
    h.sphere(0.065, "leafDark", { x, y, z: back + 0.07 }, 0.55);
  }
  for (const x of [-0.14, 0.14]) {
    h.box(0.015, 0.1, 0.012, "leafDark", { x, y: 0.025, z: back + 0.07 });
  }
}
