// 3D 화면을 이번 프레임에 다시 그릴지 정하는 순수 계산.
//
// 사무실은 대부분의 시간 동안 **멈춘 그림**이다 — 앉은 사람은 움직이지 않는다. 그런데도 매 프레임
// 장면 전체(그림자 지도 포함)를 다시 그려, 맥 앱에서 WebContent 72% + GPU 75% 를 썼다(2D 는 20%).
// 바뀐 것이 없으면 그리지 않고, 걷는 사람이 있을 때도 걸음이 매끄러운 선까지만 그린다.
//
// `renderer3d.js` 에서 떼어 낸 이유는 DOM·WebGL 없이 검증하기 위해서다(`pnpm check:pace`).

/**
 * 걷는 사람·발 구르는 사람이 있을 때 그리는 간격. 화면 주사율 60Hz 에서 한 프레임 걸러(30fps),
 * 120Hz 에서 네 프레임에 한 번. 33.3 이 아니라 30 인 것은 프레임 간격이 33.2ms 로 조금만 일찍
 * 와도 한 프레임을 더 건너뛰어 20fps 로 떨어지기 때문이다.
 */
export const MOVING_INTERVAL_MS = 30;

/**
 * 아무것도 안 바뀌어도 이 간격으로는 한 번 그린다. 아래 `signature` 에 빠뜨린 입력이 생겨도
 * 화면이 1초 넘게 낡지 않게 하는 안전망이다 — 멈춘 그림은 오류 없이 "정상 화면" 으로 보인다.
 */
export const IDLE_INTERVAL_MS = 1000;

/**
 * 이 프레임에 **그림을 정하는 입력 전부**를 한 줄로 — 앞서 그린 것과 같으면 다시 그리지 않는다.
 * 렌더러의 `draw` 가 읽는 값을 늘리면 여기에도 넣어야 한다. 빠뜨리면 그 변화는 안전망(1초)까지
 * 늦게 나타난다.
 *
 * 걷는 사람·발 구르는 사람은 매 프레임 자리·자세가 달라지므로 값 대신 `moving` 으로 알린다 —
 * 값을 넣으면 매 프레임이 "바뀌었다" 가 되어 30fps 제한이 걸리지 않는다.
 *
 * @param {object} input
 * @param {Array}  input.scene    사람 밖의 것(hover·선택·시간대·경고등·요약 글자 등)
 * @param {object} input.bodies   그릴 사람들(`live.js` 의 몸 — 숨긴 사람은 빼고)
 * @param {object} [input.agents] 사람별 상태·말풍선
 * @param {Array}  [input.sessions]
 * @param {object} [input.pending] 사람별 지시 진행 단계(맥 앱만 준다) — 접수 대기 점·어깨 처짐을 정한다
 * @returns {{signature: string, moving: boolean}}
 */
export function frameSignature({ scene, bodies, agents, sessions, pending }) {
  let moving = false;
  const parts = [...scene];
  for (const [agentType, body] of Object.entries(bodies)) {
    const agent = agents?.[agentType];
    parts.push(agentType, agent?.state, agent?.bubble, agent?.job, agent?.nickname, agent?.displayName);
    // 잠깐 뜨는 말풍선(`!`)과 지시 단계는 걷는 중에도 글자를 바꾼다.
    parts.push(pending?.[agentType], body.flash);
    const pressure = body.seated ? 0 : (body.pressure ?? 0);
    const walking = Boolean(body.path) || (typeof body.pose === "string" && body.pose.includes("walk"));
    // 짧은 몸짓(튀어오름·흔들림)도 그동안은 매 프레임 자세가 달라진다.
    if (walking || pressure >= 3 || body.cueRemaining > 0) {
      moving = true;
      parts.push("moving");
    } else {
      parts.push(body.x, body.y, body.seated, body.facing, body.pose, body.interactionPose, pressure);
    }
  }
  for (const session of sessions ?? []) {
    parts.push(session.label, session.active);
  }
  return { signature: parts.join("|"), moving };
}

/**
 * @param {object} frame
 * @param {boolean} frame.changed   그려진 것과 지금 상태가 다르다(상태·말풍선·hover·선택·창 크기 등)
 * @param {boolean} frame.smooth    카메라가 옮겨 가는 중 — 짧고 드물어 매 프레임 그린다
 * @param {boolean} frame.moving    걷거나 발을 구르거나 짧은 몸짓 중인 사람이 있다
 * @param {number}  frame.elapsedMs 마지막으로 그린 뒤 지난 시간
 */
export function shouldRender({ changed, smooth, moving, elapsedMs }) {
  if (changed || smooth) {
    return true;
  }
  return elapsedMs >= (moving ? MOVING_INTERVAL_MS : IDLE_INTERVAL_MS);
}
