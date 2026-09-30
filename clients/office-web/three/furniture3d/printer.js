// 급지판·출력 틈을 얹은 세로형 복합기.
export const spec = { footprint: [1, 1], height: 0.55 };

export function build(h) {
  h.box(0.44, 0.32, 0.43, "metalLight", {});
  h.box(0.38, 0.08, 0.025, "cabinetCharcoal", { y: 0.06, z: 0.227 });
  h.box(0.18, 0.018, 0.027, "screenDark", { y: 0.21, z: 0.23 });
  h.box(0.44, 0.13, 0.43, "paper", { y: 0.32 });
  h.box(0.41, 0.035, 0.45, "cabinetCharcoal", { y: 0.44 });
  h.box(0.34, 0.035, 0.03, "screenDark", { y: 0.36, z: 0.24 });
  h.box(0.25, 0.012, 0.16, "paper", { y: 0.475, z: 0.01 });
  h.box(0.28, 0.07, 0.025, "paper", { y: 0.48, z: -0.16 });
  h.box(0.11, 0.025, 0.03, "screenGlow", { x: 0.12, y: 0.405, z: 0.24 });
}
