// 대표 브리핑 규칙 검증 — `briefing.js` 가 맥 `ConsoleCore/PresidentBriefing.swift` 와 같은 답을 내는지(`pnpm check:briefing`).
//
// 기대값은 맥·웹 공용 대조표 `../idaeri-console/fixtures/president-briefing.json` 에 있다. 맥 `ConsoleCoreTests`
// (`BriefingParityTests.swift`)가 같은 파일로 Swift 함수를 재므로, 맥 쪽 문구·상한·판정이 바뀌면 맥 테스트가 먼저
// 깨지고, 대조표를 고치면 여기가 깨진다 — 그때 `briefing.js` 를 함께 고친다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BRIEFING_DEMO,
  PRESIDENT_BUBBLE_WIDTH_TILES,
  STREAK_STAMP_DIAMETER_RATIO,
  STREAK_STAMP_HEIGHT_RATIO,
  STREAK_STAMP_MAX_COUNT,
  STREAK_STAMP_STEP_RATIO,
  acceptBriefing,
  briefingFromResponse,
  dailyReportLines,
  presidentTodoLines,
  showsDailyReport,
  streakBoardTile,
  streakStampCount,
  streakStampSaturated,
} from "./briefing.js";

const fixture = JSON.parse(
  readFileSync(new URL("../idaeri-console/fixtures/president-briefing.json", import.meta.url), "utf8")
);

assert.deepEqual(
  {
    presidentBubbleWidthTiles: PRESIDENT_BUBBLE_WIDTH_TILES,
    streakStampMaxCount: STREAK_STAMP_MAX_COUNT,
    streakStampHeightRatio: STREAK_STAMP_HEIGHT_RATIO,
    streakStampDiameterRatio: STREAK_STAMP_DIAMETER_RATIO,
    streakStampStepRatio: STREAK_STAMP_STEP_RATIO,
  },
  fixture.constants,
  "상수"
);

for (const { name, todos, expected } of fixture.presidentTodoLines) {
  assert.deepEqual(presidentTodoLines(todos), expected, name);
}

for (const { current, count, saturated } of fixture.streakStamps) {
  const streak = { current, best: 0, todayOpened: 0, todayRemaining: 0 };
  assert.equal(streakStampCount(streak), count, `연속 ${current}일 도장 수`);
  assert.equal(streakStampSaturated(streak), saturated, `연속 ${current}일 포화`);
}

const { departureHour, shownHours } = fixture.showsDailyReport;
assert.deepEqual(
  Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => showsDailyReport(hour, { departure: departureHour })),
  shownHours,
  "정산 종이를 놓는 시각"
);

for (const { name, report, streak, expected } of fixture.dailyReportLines) {
  assert.deepEqual(dailyReportLines(report, streak), expected, name);
}

for (const { name, furniture, presidentArea, expected } of fixture.streakBoardTile) {
  assert.deepEqual(streakBoardTile(furniture, presidentArea), expected, name);
}

// 입구 거르기 — 모양이 어긋난 값은 null(아무것도 안 띄움). 프레임 루프가 `streak.current` 를 읽다 멈추면 화면 전체가 굳는다.
// 이 부분은 웹 쪽 방어라 맥 대조 대상이 아니다.
const envelope = (data) => ({ code: "SUCCESS", message: "", data });
assert.equal(briefingFromResponse(envelope(BRIEFING_DEMO)), BRIEFING_DEMO);
assert.equal(briefingFromResponse(BRIEFING_DEMO), BRIEFING_DEMO, "봉투 없이 와도 받는다");
assert.equal(briefingFromResponse(null), null);
assert.equal(briefingFromResponse(envelope(null)), null, "{data:null} 이 봉투째 브리핑이 되면 안 된다");
assert.equal(briefingFromResponse(envelope({ todos: [] })), null, "streak·dailyReport 가 없으면 받지 않는다");
assert.equal(acceptBriefing(undefined), null);
assert.equal(acceptBriefing({ ...BRIEFING_DEMO, streak: null }), null);
assert.equal(acceptBriefing(BRIEFING_DEMO), BRIEFING_DEMO);
// 서버가 할 일마다 대상(targets)을 싣는다 — 3D 는 버튼을 그리지 않지만 그 필드 때문에 브리핑을 버리면 안 된다.
const withTargets = {
  ...BRIEFING_DEMO,
  todos: BRIEFING_DEMO.todos.map((todo) => ({
    ...todo,
    targets: [{ label: "PM", agentType: "PM", runId: 11, retryable: true }],
  })),
};
assert.equal(acceptBriefing(withTargets), withTargets, "대상이 실린 할 일도 받는다");

console.log("브리핑 규칙: 맥 PresidentBriefing 과 같은 답");
