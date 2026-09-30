// 보라색 세 자리 소파. 등받이와 좌방석을 세 칸으로 나눈다.
export const spec = { footprint: [2, 1], height: 0.62 };

export function build(h) {
  h.box(1.72, 0.16, 0.64, "sofaPurple", { y: 0.06 });
  h.box(1.76, 0.42, 0.16, "sofaPurple", { y: 0.2, z: -0.22 });
  for (const x of [-0.8, 0.8]) {
    h.box(0.13, 0.32, 0.59, "sofaPurple", { x, y: 0.14 });
    for (const z of [-0.23, 0.23]) {
      h.box(0.09, 0.06, 0.1, "woodDark", { x, z });
    }
  }
  for (const x of [-0.51, 0, 0.51]) {
    h.box(0.48, 0.11, 0.4, "sofaPurple", { x, y: 0.22, z: 0.06 });
    h.box(0.48, 0.3, 0.07, "sofaPurple", { x, y: 0.27, z: -0.12 });
  }
}
