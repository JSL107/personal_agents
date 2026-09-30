// 푸른 천 패널과 양끝 받침 기둥의 낮은 칸막이.
export const spec = { footprint: [1, 1], height: 0.55 };

export function build(h) {
  h.box(0.79, 0.45, 0.045, "partitionBlue", { y: 0.05 });
  h.box(0.81, 0.03, 0.06, "metalDark", { y: 0.52 });
  for (const x of [-0.43, 0.43]) {
    h.box(0.045, 0.55, 0.065, "metalDark", { x });
    h.box(0.14, 0.035, 0.24, "metalLight", { x });
  }
}
