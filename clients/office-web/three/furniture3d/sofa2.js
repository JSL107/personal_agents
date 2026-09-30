// 2인 소파 — 남쪽(+z)을 본다. 좌판·등받이·팔걸이 둘·쿠션 둘.
export const spec = { footprint: [1, 1], height: 0.62 };

export function build(h) {
  h.box(0.94, 0.18, 0.6, "sofaPurple", { y: 0.04 });
  h.box(0.94, 0.36, 0.16, "sofaPurple", { y: 0.04, z: -0.22 });
  h.box(0.12, 0.3, 0.6, "sofaPurple", { x: -0.41, y: 0.04 });
  h.box(0.12, 0.3, 0.6, "sofaPurple", { x: 0.41, y: 0.04 });
  h.box(0.34, 0.08, 0.4, "sofaPurple", { x: -0.17, y: 0.22, z: 0.04 });
  h.box(0.34, 0.08, 0.4, "sofaPurple", { x: 0.17, y: 0.22, z: 0.04 });
  for (const x of [-0.4, 0.4]) {
    for (const z of [-0.24, 0.24]) {
      h.cylinder(0.03, 0.03, 0.04, "woodDark", { x, z });
    }
  }
}
