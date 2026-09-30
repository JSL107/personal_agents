// 흰 받침대 위에 올린 푸른 물통, 전면의 온·냉수 꼭지.
export const spec = { footprint: [1, 1], height: 0.85 };

export function build(h) {
  h.box(0.42, 0.43, 0.39, "paper", { y: 0.02 });
  h.box(0.23, 0.26, 0.015, "metalLight", { y: 0.06, z: 0.203 });
  h.box(0.22, 0.09, 0.015, "cabinetCharcoal", { y: 0.24, z: 0.208 });
  for (const x of [-0.065, 0.065]) {
    h.box(0.045, 0.04, 0.05, x < 0 ? "bookBlue" : "bookRed", { x, y: 0.35, z: 0.22 });
  }
  h.cylinder(0.14, 0.16, 0.33, "waterBlue", { y: 0.46 });
  h.cylinder(0.11, 0.14, 0.055, "glass", { y: 0.79 });
  h.cylinder(0.09, 0.09, 0.015, "screenDark", { y: 0.835 });
  h.box(0.27, 0.025, 0.04, "bookBlue", { y: 0.59, z: 0.14 });
}
