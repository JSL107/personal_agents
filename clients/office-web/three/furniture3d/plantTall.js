// 큰 화분 — 원본의 크림 화분·가는 줄기·사방으로 늘어진 잎 뭉치.
// 원반을 층층이 쌓으면 침엽수처럼 읽힌다(검수에서 원본과 가장 멀었다). 둥근 잎 뭉치를 줄기
// 둘레에 나선으로 흩어, 윤곽이 들쭉날쭉한 덩굴 화분이 되게 한다.
export const spec = { footprint: [1, 1], height: 1.2 };

const CLUSTERS = [
  // [각도(라디안), 줄기에서 거리, 높이, 반지름, 색]
  [0.2, 0.16, 0.42, 0.13, "leafDark"],
  [2.3, 0.17, 0.5, 0.12, "foliageGreen"],
  [4.3, 0.15, 0.58, 0.13, "leafDark"],
  [1.2, 0.18, 0.68, 0.12, "leafLight"],
  [3.3, 0.17, 0.76, 0.13, "foliageGreen"],
  [5.4, 0.16, 0.84, 0.12, "leafLight"],
  [0.6, 0.13, 0.93, 0.11, "foliageGreen"],
  [2.8, 0.12, 1.0, 0.1, "leafLight"],
];

export function build(h) {
  h.cylinder(0.16, 0.12, 0.28, "potCream");
  h.cylinder(0.17, 0.17, 0.04, "potCream", { y: 0.26 });
  h.cylinder(0.14, 0.14, 0.015, "woodDark", { y: 0.29 });
  h.cylinder(0.022, 0.03, 0.72, "woodMid", { y: 0.3 });
  for (const [angle, reach, y, radius, key] of CLUSTERS) {
    h.sphere(radius, key, { x: Math.sin(angle) * reach, y, z: Math.cos(angle) * reach }, 0.8);
  }
  h.sphere(0.09, "foliageGreen", { y: 1.02 }, 0.9);
}
