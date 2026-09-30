// 짙은 남색 자판기 전면 상품 진열창과 오른쪽 버튼·투입구.
export const spec = { footprint: [1, 1], height: 1.1 };

export function build(h) {
  h.box(0.66, 1.07, 0.48, "vendingNavy", { y: 0.03 });
  h.box(0.42, 0.7, 0.02, "screenDark", { x: -0.095, y: 0.27, z: 0.25 });
  h.box(0.35, 0.64, 0.012, "glass", { x: -0.095, y: 0.3, z: 0.265 });
  for (const y of [0.37, 0.55, 0.73]) {
    h.box(0.32, 0.014, 0.024, "metalLight", { x: -0.095, y, z: 0.277 });
  }
  for (const [x, y, key] of [
    [-0.2, 0.61, "bookBlue"], [-0.07, 0.61, "bookMustard"],
    [0.06, 0.61, "bookRed"], [-0.2, 0.43, "bookGreen"],
    [-0.07, 0.43, "bookRed"], [0.06, 0.43, "bookBlue"],
  ]) {
    h.box(0.065, 0.105, 0.02, key, { x, y, z: 0.282 });
  }
  h.box(0.13, 0.23, 0.02, "cabinetCharcoal", { x: 0.23, y: 0.54, z: 0.254 });
  h.box(0.07, 0.035, 0.014, "metalLight", { x: 0.23, y: 0.72, z: 0.269 });
  h.box(0.19, 0.07, 0.02, "screenDark", { x: -0.13, y: 0.12, z: 0.256 });
  h.box(0.06, 0.04, 0.02, "metalLight", { x: 0.23, y: 0.33, z: 0.256 });
}
