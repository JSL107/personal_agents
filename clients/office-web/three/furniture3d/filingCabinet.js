// 짙은 회보라색 철제 캐비닛의 세 서랍과 명찰 손잡이.
export const spec = { footprint: [1, 1], height: 0.62 };

export function build(h) {
  h.box(0.4, 0.6, 0.4, "cabinetCharcoal", { y: 0.02 });
  h.box(0.38, 0.035, 0.39, "screenDark", { y: 0.585 });
  for (const y of [0.12, 0.29, 0.46]) {
    h.box(0.32, 0.14, 0.012, "metalDark", { y, z: 0.205 });
    h.box(0.1, 0.018, 0.015, "metalLight", { y: y + 0.075, z: 0.217 });
    h.box(0.08, 0.025, 0.014, "paper", { y: y + 0.028, z: 0.217 });
  }
}
