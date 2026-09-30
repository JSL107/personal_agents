import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  const rim = h.cylinder(0.215, 0.215, 0.035, "screenDark", { y: 0.215, z: back + 0.018 });
  rim.rotation.x = Math.PI / 2;
  const dial = h.cylinder(0.188, 0.188, 0.012, "paper", { y: 0.227, z: back + 0.047 });
  dial.rotation.x = Math.PI / 2;
  const pivot = 0.23;
  for (const [length, angle] of [[0.13, -0.8], [0.09, 0.7]]) {
    const centerX = -Math.sin(angle) * length / 2;
    const centerY = pivot + Math.cos(angle) * length / 2;
    const hand = h.box(0.012, length, 0.012, "screenDark", {
      x: centerX, y: centerY - length / 2, z: back + 0.058,
    });
    hand.rotation.z = angle;
  }
  for (const x of [-0.14, 0.14]) {
    h.box(0.018, 0.014, 0.01, "metalDark", { x, y: pivot - 0.007, z: back + 0.056 });
  }
  for (const y of [pivot - 0.14, pivot + 0.14]) {
    h.box(0.014, 0.018, 0.01, "metalDark", { y: y - 0.009, z: back + 0.056 });
  }
  h.sphere(0.012, "screenDark", { y: pivot - 0.012, z: back + 0.058 });
}
