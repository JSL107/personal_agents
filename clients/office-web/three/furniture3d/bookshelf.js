// 책장 — 원본의 짙은 원목 틀, 좁고 높은 몸체, 칸마다 빽빽한 책.
// 밝은 원목·낮은 비율로 두면 원본과 다른 가구가 된다(검수). 폭을 줄여 키를 살린다.
export const spec = { footprint: [1, 1], height: 1.15 };

const BOOKS = ["bookBlue", "screenDark", "bookRed", "bookGreen", "paper", "bookMustard"];

export function build(h) {
  const width = 0.72;
  const depth = 0.34;
  const z = -0.27;
  h.box(width, 1.12, 0.04, "woodDark", { z: z - depth / 2 + 0.02 });
  h.box(0.05, 1.12, depth, "woodDark", { x: -width / 2 + 0.025, z });
  h.box(0.05, 1.12, depth, "woodDark", { x: width / 2 - 0.025, z });
  for (const y of [0, 0.37, 0.74, 1.08]) {
    h.box(width, 0.04, depth, "woodMid", { y, z });
  }
  // 칸마다 가는 책 다섯 권 — 높이·색을 어긋나게 해 손으로 꽂은 것처럼.
  [0.04, 0.41, 0.78].forEach((y, shelf) => {
    for (let index = 0; index < 5; index += 1) {
      const color = BOOKS[(index + shelf * 2) % BOOKS.length];
      const height = 0.22 + ((index * 2 + shelf) % 3) * 0.035;
      h.box(0.1, height, 0.24, color, { x: -0.24 + index * 0.12, y, z: z + 0.02 });
    }
  });
}
