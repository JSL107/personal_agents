// 3D 프레임 건너뛰기 검증 — DOM 없이 node 로 돈다(`pnpm check:pace`).
import assert from "node:assert/strict";

import { IDLE_INTERVAL_MS, MOVING_INTERVAL_MS, frameSignature, shouldRender } from "./three/frame-pace.js";

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

// MARK: - 무엇이 "바뀌었다" 인가

const seated = { x: 3, y: 4, seated: true, facing: "down", pose: "down" };
const base = {
  scene: [null, false, null, 12, false, "진행 1"],
  bodies: { PM: seated, CEO: { ...seated, x: 9 } },
  agents: { PM: { state: "WAITING" }, CEO: { state: "IN_PROGRESS", bubble: "일하는 중" } },
  sessions: [{ label: "repo", active: false }],
};
const sign = (patch) => frameSignature({ ...base, ...patch });

// 같은 입력은 같은 줄 — 이것이 안 되면 멈춘 사무실도 매 프레임 그린다.
assert.equal(sign({}).signature, sign({}).signature);
assert.equal(sign({}).moving, false);

// 그림을 바꾸는 입력은 하나하나 줄을 바꿔야 한다. 빠지면 그 변화가 1초 늦게 보인다.
const changes = {
  hover: { scene: ["PM", false, null, 12, false, "진행 1"] },
  "대표 hover": { scene: [null, true, null, 12, false, "진행 1"] },
  선택: { scene: [null, false, "PM", 12, false, "진행 1"] },
  시간대: { scene: [null, false, null, 21, false, "진행 1"] },
  경고등: { scene: [null, false, null, 12, true, "진행 1"] },
  요약: { scene: [null, false, null, 12, false, "진행 2"] },
  상태: { agents: { ...base.agents, PM: { state: "FAILED" } } },
  말풍선: { agents: { ...base.agents, CEO: { state: "IN_PROGRESS", bubble: "완료했어요!" } } },
  "하는 일": { agents: { ...base.agents, CEO: { ...base.agents.CEO, job: "리뷰" } } },
  자리: { bodies: { ...base.bodies, PM: { ...seated, x: 5 } } },
  방향: { bodies: { ...base.bodies, PM: { ...seated, facing: "left" } } },
  "일어섬": { bodies: { ...base.bodies, PM: { ...seated, seated: false } } },
  "소파 착석": { bodies: { ...base.bodies, PM: { ...seated, interactionPose: "sitting" } } },
  "서류 들기": { bodies: { ...base.bodies, PM: { ...seated, seated: false, pressure: 2 } } },
  퇴근: { bodies: { CEO: base.bodies.CEO } },
  "세션 활성": { sessions: [{ label: "repo", active: true }] },
  "세션 이름": { sessions: [{ label: "other", active: false }] },
};
for (const [name, patch] of Object.entries(changes)) {
  assert.notEqual(sign(patch).signature, sign({}).signature, `${name} 이(가) 바뀌어도 다시 그리지 않는다`);
}

// 걷는 사람 — 자리는 매 프레임 달라지지만 줄은 그대로여야 30fps 제한이 걸린다.
const walking = (x) => ({ bodies: { ...base.bodies, PM: { x, y: 4, seated: false, facing: "right", pose: "right-walk1", path: [{ x: 9, y: 4 }] } } });
assert.equal(sign(walking(3.2)).moving, true);
assert.equal(sign(walking(3.2)).signature, sign(walking(3.6)).signature, "걷는 동안 자리가 줄에 들어가 매 프레임 그린다");
// 걷다 멈추면(도착) 줄이 달라져 그 프레임을 바로 그린다 — 안 그러면 마지막 걸음 자세로 1초 남는다.
const arrived = { bodies: { ...base.bodies, PM: { x: 9, y: 4, seated: false, facing: "right", pose: "right" } } };
assert.notEqual(sign(walking(8.9)).signature, sign(arrived).signature);
assert.equal(sign(arrived).moving, false);
// 발 구르기(3단계)는 서 있을 때만 움직임이다 — 앉은 사람에게는 표현하지 않는다.
assert.equal(sign({ bodies: { PM: { ...seated, seated: false, pressure: 3 } } }).moving, true);
assert.equal(sign({ bodies: { PM: { ...seated, pressure: 3 } } }).moving, false);

console.log("✅ 3D 프레임 건너뛰기 검증 통과");
