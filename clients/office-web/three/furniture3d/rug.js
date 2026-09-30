// 러그 세 종 — 바닥에 깐 얇은 판 두 겹(테두리·안쪽). 색만 다르다.
export const spec = { footprint: [2, 2], height: 0.04 };

const COLORS = {
  rugGreen: ["leafDark", "fabricSage"],
  rugBeige: ["woodLight", "fabricCream"],
  rugNavy: ["screenDark", "fabricBlue"],
};

export function buildFor(kind) {
  return (h) => {
    const [edge, inner] = COLORS[kind];
    h.box(1.8, 0.02, 1.8, edge);
    h.box(1.6, 0.02, 1.6, inner, { y: 0.015 });
  };
}

export const kinds = Object.keys(COLORS);
