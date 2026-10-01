// 이름표 겹침 풀기 검사 — `node scripts-check-labels.mjs` (pnpm check:labels).
//
// 회의석처럼 한 칸 간격으로 선 사람들의 이름표가 서로·문패와 포개지지 않는지, 머리에서 멀리
// 떠나지 않는지, 겹치지 않는 판은 그대로인지를 화면 없이 숫자로 본다(`three/label-separation.js`).

import { separateLabels } from "./three/label-separation.js";

let failures = 0;
function expect(name, condition) {
  console.log(`${condition ? "✓" : "✗"} ${name}`);
  if (!condition) {
    failures += 1;
  }
}

const GAP = 2;
const box = (key, x, y, width = 52, height = 20) => ({
  key,
  left: x - width / 2,
  right: x + width / 2,
  top: y - height / 2,
  bottom: y + height / 2,
});
const apply = (label, offset) => ({
  ...label,
  left: label.left + offset.dx,
  right: label.right + offset.dx,
  top: label.top + offset.dy,
  bottom: label.bottom + offset.dy,
});
const overlaps = (a, b) =>
  a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP;
const distance = (offset) => Math.hypot(offset.dx, offset.dy);

// 회의석 넷 + 회의실 문패 — 1424×872 캡처에서 잰 화면 좌표와 같은 배치(테이블 좌우 두 줄, 위 오른쪽에 문패).
const meeting = [box("A", 290, 300), box("B", 330, 285), box("C", 405, 262), box("D", 445, 248)];
const plate = { left: 420, right: 555, top: 248, bottom: 294 };
const offsets = separateLabels(meeting, [plate], GAP);
const result = meeting.map((label) => apply(label, offsets.get(label.key)));
expect(
  "회의석 넷의 이름표가 서로 겹치지 않는다",
  result.every((a, i) => result.every((b, j) => i === j || !overlaps(a, b)))
);
expect("문패와도 겹치지 않는다", result.every((label) => !overlaps(label, plate)));
expect("맨 앞(화면 아래) 사람의 판은 움직이지 않는다", distance(offsets.get("A")) === 0);
expect("아래로는 내리지 않는다", [...offsets.values()].every((offset) => offset.dy <= 0));
// 처음 구현(위로만 쌓기)은 같은 배치에서 판을 100px 넘게 띄웠다 — 누구 이름인지가 사라지는 거리다.
const farthest = Math.max(...[...offsets.values()].map(distance));
expect(`머리에서 멀리 떠나지 않는다(최대 ${Math.round(farthest)}px ≤ 판 세 개 높이 66px)`, farthest <= 66);

// 책상 줄처럼 떨어져 있으면 아무도 안 움직인다.
const desks = [box("P", 100, 300), box("Q", 220, 300), box("R", 100, 200)];
expect(
  "겹치지 않는 판은 그대로 둔다",
  [...separateLabels(desks, [], GAP).values()].every((offset) => distance(offset) === 0)
);

// 문패에 스치기만 한 판은 그대로 둔다 — 실제 조감도에서 책상 자리 이름표 셋이 문패와 0.1px 겹쳐 있었다
// (이름표 [1054.9, 443.4 – 1101.9, 465.4] · 문패 [1080.2, 416.5 – 1143.2, 443.5]).
const touching = [{ key: "T", left: 1054.9, top: 443.4, right: 1101.9, bottom: 465.4 }];
const touchPlate = { left: 1080.2, top: 416.5, right: 1143.2, bottom: 443.5 };
const touched = separateLabels(touching, [touchPlate], GAP).get("T");
expect("0.1px 스친 판은 움직이지 않는다", distance(touched) === 0);

// 같은 입력이면 같은 결과 — 순서가 바뀌어도.
const again = separateLabels([...meeting].reverse(), [plate], GAP);
expect(
  "입력 순서와 무관하게 같은 모양으로 놓인다",
  meeting.every((label) => {
    const a = again.get(label.key);
    const b = offsets.get(label.key);
    return a.dx === b.dx && a.dy === b.dy;
  })
);

// 아주 빽빽해도(열 명이 한 점) 겹친 채 남지 않는다 — 탐색이 막히면 위로 쌓는 길로 떨어진다.
const pile = Array.from({ length: 10 }, (_, index) => box(`K${index}`, 300, 300));
const piled = separateLabels(pile, [], GAP);
const piledBoxes = pile.map((label) => apply(label, piled.get(label.key)));
expect(
  "열 명이 한 점에 모여도 서로 겹치지 않는다",
  piledBoxes.every((a, i) => piledBoxes.every((b, j) => i === j || !overlaps(a, b)))
);

if (failures > 0) {
  console.error(`이름표 겹침 검사 실패 ${failures}건`);
  process.exit(1);
}
console.log("이름표 겹침 검사 통과");
