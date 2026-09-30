// 휴지통 — 원본의 키 큰 검은 통, 회색 테두리, 입구로 보이는 흰 휴지.
// 원본은 사람 허리께까지 오는 통이다. 낮은 그릇으로 두면 바닥 얼룩처럼 읽혔다(검수).
export const spec = { footprint: [1, 1], height: 0.46 };

export function build(h) {
  h.cylinder(0.15, 0.13, 0.4, "cabinetCharcoal");
  h.cylinder(0.165, 0.165, 0.045, "metalDark", { y: 0.39 });
  h.cylinder(0.13, 0.13, 0.01, "screenDark", { y: 0.435 });
  h.sphere(0.06, "paper", { x: 0.03, y: 0.38 }, 0.6);
}
