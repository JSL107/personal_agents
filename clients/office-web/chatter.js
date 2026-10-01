// 배회 대사 — 목적지에 도착한 사람의 한 마디, 근처에 멈춰 선 사람이 있으면 주고받는 두 마디.
//
// 맥 `ConsoleCore/OfficeChatter.swift` 의 **고르는 규칙만** 옮겼다. 문구·상한·확률은 평면도의
// `chatter`(맥 `officeChatterExport`)로 받는다 — 문구를 여기 다시 적으면 한쪽만 바뀐다.
// 결정론이다(같은 사람·같은 회차 → 같은 문구). `Math.random` 을 쓰지 않는다.
// DOM 없이 돌아 `scripts-check-pace.mjs` 가 검사한다.

/** 사람 이름과 회차로 만드는 씨앗 — 맥 `officeChatterSeed` 와 같은 값을 낸다. */
export function chatterSeed(agentType, round) {
  let folded = 0;
  for (const character of agentType) {
    folded = (folded * 31 + character.codePointAt(0)) & 0x00ffffff;
  }
  return Math.abs((folded + round * 7) % 1_000_003);
}

/** 음수 씨앗도 배열 범위 안으로 감는다(맥 `officeChatterIndex`). */
export function chatterIndex(seed, count) {
  if (count <= 0) {
    return 0;
  }
  return ((seed % count) + count) % count;
}

/** 체비쇼프 거리 — 대각선 이웃도 옆에 선 것으로 본다. */
export function tileDistance(left, right) {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

/** 혼잣말 — 열 번 중 `smallTalkChance` 번은 부서 잡담, 나머지는 그 가구 앞 대사(맥 `officeChatter`). */
export function chatterLine(chatter, { kind, department, agentType, round }) {
  const seed = chatterSeed(agentType, round);
  const wantsSmallTalk = chatterIndex(seed, 10) < chatter.smallTalkChance;
  const destination = chatter.destinations?.[kind];
  if (!wantsSmallTalk && destination) {
    return destination;
  }
  const lines = chatter.smallTalk?.[department] ?? [];
  return lines.length > 0 ? lines[chatterIndex(seed, lines.length)] : (destination ?? null);
}

/** 마주친 두 사람의 두 마디(맥 `officeChatterExchange`). */
export function chatterExchange(chatter, round, seed) {
  return {
    opener: chatter.openers[chatterIndex(seed, chatter.openers.length)],
    reply: chatter.replies[chatterIndex(seed + round + 1, chatter.replies.length)],
  };
}

/**
 * 도착한 사람 옆에 멈춰 선 대화 상대(맥 `officeChatterPartner`). 가까운 쪽, 같으면 이름 순.
 * @param {{x:number,y:number}} arrivedAt
 * @param {Array<{agentType:string, tile:{x:number,y:number}}>} others 걸음이 끝나 머무는 배회자만
 */
export function chatterPartner(arrivedAt, others, maxDistance) {
  return (
    others
      .map((other) => ({ agentType: other.agentType, distance: tileDistance(arrivedAt, other.tile) }))
      .filter((other) => other.distance <= maxDistance)
      .sort((left, right) =>
        left.distance !== right.distance
          ? left.distance - right.distance
          : left.agentType < right.agentType
            ? -1
            : left.agentType > right.agentType
              ? 1
              : 0
      )[0]?.agentType ?? null
  );
}
