// 대표 브리핑 규칙 검증 — `briefing.js` 가 맥 `ConsoleCore/PresidentBriefing.swift` 와 같은 답을 내는지(`pnpm check:briefing`).
//
// 기대값은 손으로 지은 것이 아니라 **맥 함수를 실제로 돌린 출력**이다(2026-10-08, PresidentBriefing.swift 를 그대로
// 컴파일해 같은 입력을 넣었다). 맥 쪽 문구·상한·판정을 바꾸면 이 기대값이 깨져야 정상이다 — 그때 `briefing.js` 를
// 함께 고친다. 여기를 먼저 고쳐 통과시키면 두 화면이 같은 브리핑을 다르게 말하게 된다.
import assert from "node:assert/strict";

import {
  BRIEFING_DEMO,
  STREAK_STAMP_DIAMETER_RATIO,
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

const todo = (kind, label, detail) => ({ kind, label, detail });
const streak = (current, best) => ({ current, best, todayOpened: 0, todayRemaining: 0 });

// 할 일 말풍선 후보 — 긴 것부터, 마지막은 라벨까지 버린 건수.
assert.deepEqual(presidentTodoLines([]), []);
assert.deepEqual(presidentTodoLines([todo("PR_REVIEW", "PR #760 리뷰 회수", "오늘")]), [
  "PR #760 리뷰 회수 — 오늘",
  "PR #760 리뷰 회수",
  "할 일 1가지",
]);
assert.deepEqual(
  presidentTodoLines([
    todo("APPROVAL", "승인 3건", "19:04 만료"),
    todo("FAILED_RUN", "PM 재시도", "다음 실행은 내일"),
    todo("PR_REVIEW", "PR 리뷰 회수 2건", "10일째"),
  ]),
  ["승인 3건 — 19:04 만료 · 외 2건", "승인 3건 · 외 2건", "승인 3건 외 2건", "할 일 3가지"]
);

// 도장 — 상한에서 자르고, 음수는 0, 상한을 넘기면 포화.
assert.deepEqual(
  [0, 3, 5, 6, 40, -2].map((current) => streakStampCount(streak(current, 0))),
  [0, 3, 5, 5, 5, 0]
);
assert.deepEqual(
  [5, 6, 0].map((current) => streakStampSaturated(streak(current, 8))),
  [false, true, false]
);
// 상한까지 찍어도 게시판 폭을 넘지 않고, 도장끼리 붙지 않는다(맥 테스트와 같은 관계).
assert.ok(STREAK_STAMP_STEP_RATIO * (STREAK_STAMP_MAX_COUNT - 1) + STREAK_STAMP_DIAMETER_RATIO <= 1);
assert.ok(STREAK_STAMP_STEP_RATIO > STREAK_STAMP_DIAMETER_RATIO);

// 정산 종이 — 퇴근 시각부터 23시까지. 경계 숫자는 평면도의 값을 쓴다.
assert.deepEqual(
  Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => showsDailyReport(hour, { departure: 21 })),
  [21, 22, 23]
);

// 정산 카드 문장 — 결재 0건 / 일부 남음 / 전부 처리, 연속 이어짐 / 끊김 / 기록 없음.
const report = (approvalsOpened, approvalsHandled, pendingReviewPulls) => ({
  date: "d", succeeded: 21, failed: 1, approvalsOpened, approvalsHandled, pendingReviewPulls,
});
assert.deepEqual(dailyReportLines(report(3, 0, 2), streak(8, 8)), [
  "오늘 21건 끝냈고 1건 엎어졌습니다.",
  "결재 3건 중 3건이 남았습니다. 자정을 넘기면 연속 기록이 끊깁니다.",
  "리뷰 회수를 기다리는 PR 이 2건 있습니다.",
  "깨끗하게 마감 8일 연속 (최고 8일).",
]);
assert.deepEqual(dailyReportLines(report(0, 0, 0), streak(0, 3)), [
  "오늘 21건 끝냈고 1건 엎어졌습니다.",
  "결재는 올라온 것이 없었습니다.",
  "연속 기록은 끊겼습니다. 최고 3일.",
]);
assert.deepEqual(dailyReportLines(report(2, 2, 0), streak(0, 0)), [
  "오늘 21건 끝냈고 1건 엎어졌습니다.",
  "결재 2건 전부 오늘 안에 처리했습니다.",
]);

// 게시판 칸 — 대표실 벽(가로 범위 안 · 문패 줄보다 위)만. 다른 방 게시판·문패 줄 위·대표실 없음은 null.
const president = { kind: "president", originX: 12, width: 12, labelY: 15 };
const boards = [
  { kind: "wallPinboard", tile: { x: 12, y: 10 } },
  { kind: "wallPinboard", tile: { x: 13, y: 15 } },
  { kind: "wallCalendar", tile: { x: 14, y: 18 } },
  { kind: "wallPinboard", tile: { x: 13, y: 18 } },
];
assert.deepEqual(streakBoardTile(boards, president), { x: 13, y: 18 });
assert.equal(streakBoardTile(boards.slice(0, 3), president), null);
assert.equal(streakBoardTile(boards, undefined), null);

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

console.log("브리핑 규칙: 맥 PresidentBriefing 과 같은 답");
