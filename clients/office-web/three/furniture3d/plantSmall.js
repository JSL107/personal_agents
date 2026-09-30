// 작은 크림색 화분에서 빽빽하게 퍼진 초록 잎.
export const spec = { footprint: [1, 1], height: 0.45 };

export function build(h) {
  h.cylinder(0.12, 0.1, 0.16, "potCream", {});
  h.cylinder(0.125, 0.125, 0.025, "paper", { y: 0.155 });
  h.cylinder(0.03, 0.03, 0.12, "woodDark", { y: 0.15 });
  for (const [x, y, z, key] of [
    [0, 0.27, 0, "foliageGreen"], [-0.1, 0.25, 0, "leafDark"],
    [0.1, 0.25, 0, "leafLight"], [0, 0.24, -0.1, "leafDark"],
    [0, 0.24, 0.1, "foliageGreen"], [-0.06, 0.3, 0.06, "leafLight"],
    [0.07, 0.3, -0.06, "foliageGreen"],
  ]) {
    h.sphere(0.11, key, { x, y, z }, 0.65);
  }
}
