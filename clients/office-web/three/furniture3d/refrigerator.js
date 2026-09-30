// 흰색 상하 문과 손잡이가 분리된 냉장고.
export const spec = { footprint: [1, 1], height: 1.05 };

export function build(h) {
  h.box(0.58, 1.02, 0.46, "paper", { y: 0.03 });
  h.box(0.52, 0.26, 0.018, "paper", { y: 0.76, z: 0.239 });
  h.box(0.52, 0.61, 0.018, "paper", { y: 0.11, z: 0.239 });
  h.box(0.56, 0.025, 0.025, "metalLight", { y: 0.73, z: 0.25 });
  h.box(0.025, 0.12, 0.025, "metalLight", { x: -0.18, y: 0.51, z: 0.26 });
  h.box(0.025, 0.08, 0.025, "metalLight", { x: -0.18, y: 0.82, z: 0.26 });
  h.box(0.1, 0.025, 0.013, "metalLight", { x: 0.15, y: 0.83, z: 0.251 });
  for (const x of [-0.2, 0.2]) {
    h.box(0.08, 0.03, 0.3, "screenDark", { x });
  }
}
