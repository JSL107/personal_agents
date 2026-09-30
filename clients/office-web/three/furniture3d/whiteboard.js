// 바퀴 달린 이동식 흰 보드. 하단 펜 받침과 양쪽 다리가 있다.
export const spec = { footprint: [1, 1], height: 1.1 };

export function build(h) {
  h.box(0.84, 0.67, 0.04, "metalDark", { y: 0.4 });
  h.box(0.79, 0.62, 0.012, "paper", { y: 0.425, z: 0.027 });
  h.box(0.83, 0.025, 0.11, "metalLight", { y: 0.39, z: 0.07 });
  h.box(0.07, 0.016, 0.025, "bookRed", { x: -0.21, y: 0.415, z: 0.12 });
  h.box(0.07, 0.016, 0.025, "screenDark", { x: -0.1, y: 0.415, z: 0.12 });
  for (const x of [-0.39, 0.39]) {
    h.box(0.035, 1.1, 0.045, "metalDark", { x });
    h.box(0.1, 0.035, 0.31, "metalDark", { x });
    for (const z of [-0.12, 0.12]) {
      h.cylinder(0.035, 0.035, 0.035, "screenDark", { x, y: 0.005, z });
    }
  }
  h.box(0.8, 0.03, 0.04, "metalDark", { y: 0.04 });
}
