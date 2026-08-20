/**
 * 대표 브리핑 — 화면이 "대표가 무엇을 해야 하는지" 를 말하기 위해 쓰는 뷰 타입.
 *
 * `console.type.ts` 의 스냅샷이 **지금 상태**를 담는다면 여기는 **집계**를 담는다. 스냅샷에
 * 얹지 않고 따로 두는 이유는 갱신 주기가 다르고(스냅샷은 부팅 1회 + SSE 증분), 집계가
 * 실패해도 관제 화면이 죽지 않아야 하기 때문이다.
 */

/** 할 일 한 줄의 종류. 화면이 아이콘·색을 고르는 데 쓴다. */
export enum ConsoleTodoKind {
  /** 승인 대기 카드가 열려 있다 — 대표실 앞 줄. */
  APPROVAL = 'APPROVAL',
  /** 오늘 실패했고 오늘 안에 다시 돌지 않는 워커. */
  FAILED_RUN = 'FAILED_RUN',
  /** GitHub 에 게시됐는데 아직 반응이 없는 리뷰 지적. */
  PR_REVIEW = 'PR_REVIEW',
}

/**
 * 회의실 화이트보드에 적히는 한 줄.
 *
 * 종류마다 최대 한 줄이라 목록은 3줄을 넘지 않는다 — "외 N건" 같은 넘침 처리가 없는 이유다.
 */
export interface ConsoleTodo {
  readonly kind: ConsoleTodoKind;
  /** 보드에 그대로 적히는 문구. 예: '승인 2건', 'PR #1005 리뷰 회수' */
  readonly label: string;
  /** 급한 정도 한 줄. 예: '오늘 19:04 만료', '11일째' */
  readonly detail: string;
}

/**
 * 연속 기록 — "그날 뜬 승인 카드를 그날 자정 전에 다 처리했는가" 를 하루 단위로 센다.
 *
 * 마감선을 만료(TTL 24시간)가 아니라 자정으로 잡은 것은 실측 결과다. 만료 기준으로는 13일
 * 연속 끊긴 적이 없어(2026-08-08 이후 만료 0건) 화면에 늘 같은 숫자가 붙는다. 카드가 19시에
 * 떠서 자정까지 5시간뿐인 자정 기준은 최근 10일 중 4일이 끊겼다.
 */
export interface ConsoleStreak {
  /** 어제까지 이어진 연속 일수. 오늘은 자정에 판정하므로 포함하지 않는다. */
  readonly current: number;
  /** 원장 전체에서 가장 길었던 연속. 창을 씌우지 않는다 — 씌우면 기록이 시간이 지나며 줄어든다. */
  readonly best: number;
  /** 오늘 뜬 카드 수. 0이면 오늘은 아직 셀 일이 없다(중립). */
  readonly todayOpened: number;
  /** 오늘 뜬 카드 중 아직 처리하지 않은 수. 이게 0으로 자정을 넘겨야 도장이 찍힌다. */
  readonly todayRemaining: number;
}

/** 퇴근 정산 — 21시 이후 대표 옆에 놓이는 종이 한 장의 내용. */
export interface ConsoleDailyReport {
  /** KST YYYY-MM-DD. */
  readonly date: string;
  readonly succeeded: number;
  readonly failed: number;
  /** 오늘 뜬 승인 카드 수. */
  readonly approvalsOpened: number;
  /** 그중 오늘 안에 처리한 수. */
  readonly approvalsHandled: number;
  /** 아직 반응이 없는 리뷰 지적이 남은 PR 수. */
  readonly pendingReviewPulls: number;
}

/** `GET /v1/console/briefing` 응답 전체. */
export interface ConsoleBriefing {
  readonly todos: ConsoleTodo[];
  readonly streak: ConsoleStreak;
  readonly dailyReport: ConsoleDailyReport;
  readonly serverTime: string;
}
