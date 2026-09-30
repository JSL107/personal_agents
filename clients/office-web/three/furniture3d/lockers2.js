// 한 몸체에 나뉜 두 개의 세로 철제 사물함.
export const spec = { footprint: [1, 1], height: 1.0 };

export function build(h) {
  h.box(0.48, 0.94, 0.38, "cabinetCharcoal", { y: 0.04 });
  h.box(0.5, 0.04, 0.4, "screenDark", { y: 0.96 });
  h.box(0.018, 0.86, 0.018, "screenDark", { y: 0.08, z: 0.2 });
  for (const x of [-0.12, 0.12]) {
    h.box(0.21, 0.83, 0.015, "metalDark", { x, y: 0.11, z: 0.201 });
    h.box(0.055, 0.02, 0.018, "screenDark", { x, y: 0.72, z: 0.213 });
    h.box(0.025, 0.05, 0.019, "metalLight", { x: x + 0.06, y: 0.49, z: 0.213 });
    h.box(0.08, 0.05, 0.019, "screenDark", { x, y: 0.16, z: 0.213 });
    h.box(0.06, 0.04, 0.1, "screenDark", { x, z: 0 });
  }
}
