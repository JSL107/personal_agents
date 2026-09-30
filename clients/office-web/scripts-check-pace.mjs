// 3D 프레임 건너뛰기 검증 — DOM 없이 node 로 돈다(`pnpm check:pace`).
import assert from "node:assert/strict";

import { IDLE_INTERVAL_MS, MOVING_INTERVAL_MS, shouldRender } from "./three/frame-pace.js";

/** 주사율 `hz` 로 `seconds` 동안 돌렸을 때 실제로 그린 횟수. */
function rendered(hz, seconds, frame) {
  let last = 0;
  let count = 0;
  // 간격을 더해 가면 부동소수 오차가 쌓여 60번째 프레임이 999.99ms 가 된다 — 번호로 곱한다.
  for (let index = 1; index <= hz * seconds; index += 1) {
    const now = (index * 1000) / hz;
    if (shouldRender({ changed: false, smooth: false, moving: false, ...frame, elapsedMs: now - last })) {
      last = now;
      count += 1;
    }
  }
  return count;
}

// 멈춘 사무실 — 1초에 한 번(안전망)만 그린다. 이것이 CPU 를 줄이는 몫의 전부다.
assert.equal(rendered(60, 10, {}), 10);
assert.equal(rendered(120, 10, {}), 10);

// 걷는 사람이 있으면 30fps. 주사율이 달라도 같아야 한다.
assert.equal(rendered(60, 1, { moving: true }), 30, "60Hz 에서 한 프레임 걸러 그려야 한다");
assert.equal(rendered(120, 1, { moving: true }), 30, "120Hz 에서도 30fps 여야 한다");

// 카메라 전환은 매 프레임.
assert.equal(rendered(60, 1, { smooth: true }), 60);

// **바뀐 것은 기다리지 않는다** — hover·상태 변화가 다음 안전망(1초)까지 밀리면 안 된다.
assert.equal(shouldRender({ changed: true, smooth: false, moving: false, elapsedMs: 0 }), true);
assert.equal(shouldRender({ changed: false, smooth: false, moving: false, elapsedMs: IDLE_INTERVAL_MS - 1 }), false);
assert.equal(shouldRender({ changed: false, smooth: false, moving: true, elapsedMs: MOVING_INTERVAL_MS - 1 }), false);

console.log("✅ 3D 프레임 건너뛰기 검증 통과");
