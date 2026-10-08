// 대표 브리핑(`GET /v1/console/briefing`)을 화면 표시로 바꾸는 규칙 — 맥 `ConsoleCore/PresidentBriefing.swift` 를 옮겼다.
//
// 할 일 말풍선 문구 후보·연속 도장 개수·정산 종이를 띄울 시각·정산 카드 문장을 고르는 판정은
// **맥과 한 글자도 달라지면 안 된다** — 같은 브리핑을 두 화면이 다르게 말하게 된다. 이 파일은 맥 함수의
// 이름·순서·문구를 그대로 따르고, `pnpm check:briefing` 이 맥 테스트(`PresidentBriefingTests.swift`)와
// 같은 입력으로 같은 결과가 나오는지 확인한다. 맥 쪽을 고치면 여기와 그 검사를 함께 고친다.
//
// 시각 경계(퇴근 시각)는 숫자를 다시 적지 않고 평면도의 `attendanceHours` 를 읽는다(README 「배치 규칙」).

/** 대표 말풍선이 쓸 수 있는 가로 폭(칸) — 맥 `officePresidentBubbleWidthTiles`. */
export const PRESIDENT_BUBBLE_WIDTH_TILES = 4.6;

/** 게시판에 찍을 수 있는 도장의 최대 개수 — 맥 `officeStreakStampMaxCount`. */
export const STREAK_STAMP_MAX_COUNT = 5;
/** 도장 높이(게시판 높이 대비) — 맥 `officeStreakStampHeightRatio`. */
export const STREAK_STAMP_HEIGHT_RATIO = 0.42;
/** 도장 지름(게시판 폭 대비) — 맥 `officeStreakStampDiameterRatio`. */
export const STREAK_STAMP_DIAMETER_RATIO = 0.13;
/** 도장 간격(게시판 폭 대비) — 맥 `officeStreakStampStepRatio`. */
export const STREAK_STAMP_STEP_RATIO = 0.16;

/**
 * 대표 머리 위에 띄울 할 일 문장 후보 — **긴 것부터**. 비어 있으면 말풍선을 띄우지 않는다.
 * 몫에 들어가는 첫 후보를 고르는 것은 폭을 아는 쪽(렌더러)이다. 상세를 먼저 버리고 건수를 남긴다 —
 * 나머지 할 일이 있다는 사실은 이 한 줄이 유일한 통로다. 마지막 후보는 라벨까지 버린 "할 일 N가지"
 * (`todos` 한 항목은 한 건이 아니라 한 종류다).
 */
export function presidentTodoLines(todos) {
  const first = todos?.[0];
  if (!first) {
    return [];
  }
  const remaining = todos.length - 1;
  const countOnly = `할 일 ${todos.length}가지`;
  if (remaining <= 0) {
    return [`${first.label} — ${first.detail}`, first.label, countOnly];
  }
  return [
    `${first.label} — ${first.detail} · 외 ${remaining}건`,
    `${first.label} · 외 ${remaining}건`,
    `${first.label} 외 ${remaining}건`,
    countOnly,
  ];
}

/** 게시판에 찍히는 도장 수 — 어제까지 이어진 연속 일수(상한에서 자른다). */
export function streakStampCount(streak) {
  return Math.max(0, Math.min(streak.current, STREAK_STAMP_MAX_COUNT));
}

/** 연속 일수가 도장 상한을 넘었는가. 넘었으면 마지막 도장을 금색으로 칠한다. */
export function streakStampSaturated(streak) {
  return streak.current > STREAK_STAMP_MAX_COUNT;
}

/** 퇴근 정산 종이를 지금 놓아야 하는가 — 퇴근 시각부터 자정 전까지. 맥 `officeShowsDailyReport`. */
export function showsDailyReport(hour, attendanceHours) {
  return hour >= attendanceHours.departure && hour <= 23;
}

/** 정산 종이를 펼쳤을 때 읽는 문장들. 맥 `officeDailyReportLines`. */
export function dailyReportLines(report, streak) {
  const lines = [`오늘 ${report.succeeded}건 끝냈고 ${report.failed}건 엎어졌습니다.`];
  if (report.approvalsOpened === 0) {
    lines.push("결재는 올라온 것이 없었습니다.");
  } else if (report.approvalsHandled === report.approvalsOpened) {
    lines.push(`결재 ${report.approvalsOpened}건 전부 오늘 안에 처리했습니다.`);
  } else {
    const left = report.approvalsOpened - report.approvalsHandled;
    lines.push(
      `결재 ${report.approvalsOpened}건 중 ${left}건이 남았습니다. 자정을 넘기면 연속 기록이 끊깁니다.`
    );
  }
  if (report.pendingReviewPulls > 0) {
    lines.push(`리뷰 회수를 기다리는 PR 이 ${report.pendingReviewPulls}건 있습니다.`);
  }
  if (streak.current > 0) {
    lines.push(`깨끗하게 마감 ${streak.current}일 연속 (최고 ${streak.best}일).`);
  } else if (streak.best > 0) {
    lines.push(`연속 기록은 끊겼습니다. 최고 ${streak.best}일.`);
  }
  return lines;
}

/**
 * 연속 도장을 찍을 게시판 칸 — 대표실 벽에 걸린 것만. 맥 `officeStreakBoardTile`.
 * 게시판은 다른 방 벽에도 있어 `kind` 만으로 찾으면 도장이 남의 방에 찍힌다.
 */
export function streakBoardTile(furniture, presidentArea) {
  if (!presidentArea) {
    return null;
  }
  return (
    furniture.find(
      (placement) =>
        placement.kind === "wallPinboard" &&
        placement.tile.x >= presidentArea.originX &&
        placement.tile.x < presidentArea.originX + presidentArea.width &&
        placement.tile.y > presidentArea.labelY
    )?.tile ?? null
  );
}

/**
 * `?briefing=1` 이 쓰는 브리핑 — 맥 `briefingDemoValue`(`--briefing-demo`)와 같은 값.
 * 실 백엔드는 할 일 0건·연속 0일인 날이 많아 이 입구 없이는 세 표시가 한 번에 뜨지 않는다.
 * 연속 8일은 도장 상한(5)을 넘긴 값이라 금색 포화 표식까지 보인다.
 */
export const BRIEFING_DEMO = Object.freeze({
  todos: [
    { kind: "APPROVAL", label: "승인 3건", detail: "19:04 만료" },
    { kind: "FAILED_RUN", label: "PM 재시도", detail: "다음 실행은 내일" },
    { kind: "PR_REVIEW", label: "PR 리뷰 회수 2건", detail: "10일째" },
  ],
  streak: { current: 8, best: 8, todayOpened: 3, todayRemaining: 3 },
  dailyReport: {
    date: "2026-08-20",
    succeeded: 21,
    failed: 1,
    approvalsOpened: 3,
    approvalsHandled: 0,
    pendingReviewPulls: 2,
  },
  serverTime: null,
});
