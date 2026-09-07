// 캔버스 크기 계산 검증 — DOM 없이 node 로 돈다(`pnpm check:canvas`).
import assert from "node:assert/strict";

import { canvasSizes } from "./canvas-size.js";

// 기본: 백버퍼는 실제 픽셀, CSS 는 논리 픽셀.
{
  const s = canvasSizes(1000, 800, 2);
  assert.equal(s.cssWidth, 1000);
  assert.equal(s.bufferWidth, 2000, "Retina 에서 백버퍼가 두 배여야 도트가 선명하다");
}

// **DPR 전환 경로** — 논리 크기와 DPR 이 반대로 변하면 백버퍼가 그대로다.
// 백버퍼 조건만 보고 CSS 를 갱신하면 이 경로에서 CSS 가 옛 값으로 남아 캔버스가 잘린다.
{
  const before = canvasSizes(1000, 800, 2);
  const after = canvasSizes(2000, 1600, 1);
  assert.equal(before.bufferWidth, after.bufferWidth, "백버퍼는 같은 경로여야 한다");
  assert.equal(before.bufferHeight, after.bufferHeight, "백버퍼는 같은 경로여야 한다");
  assert.notEqual(before.cssWidth, after.cssWidth, "CSS 크기는 달라야 한다");
  assert.notEqual(before.cssHeight, after.cssHeight, "CSS 크기는 달라야 한다");
}

// DPR 이 이상한 값이어도 1 로 떨어진다 — 캔버스가 0 이 되면 화면이 통째로 빈다.
for (const bad of [0, -1, Number.NaN, undefined]) {
  const s = canvasSizes(800, 600, bad);
  assert.equal(s.bufferWidth, 800, `pixelRatio ${bad} 는 1 로 취급해야 한다`);
}

console.log("✅ 캔버스 크기 계산 검증 통과");
