// 금속 기둥 사이 두 장의 옅은 푸른 유리와 가로대.
export const spec = { footprint: [1, 1], height: 0.9 };

export function build(h) {
  h.box(0.96, 0.04, 0.2, "metalDark", { y: 0.02 });
  for (const x of [-0.41, 0.41]) {
    h.box(0.045, 0.86, 0.055, "metalDark", { x, y: 0.04 });
    h.box(0.15, 0.035, 0.25, "metalLight", { x });
  }
  h.box(0.77, 0.035, 0.05, "metalDark", { y: 0.865 });
  h.box(0.75, 0.35, 0.025, "glass", { y: 0.49 });
  h.box(0.75, 0.35, 0.025, "glass", { y: 0.09 });
  h.box(0.77, 0.035, 0.05, "metalLight", { y: 0.45 });
}
