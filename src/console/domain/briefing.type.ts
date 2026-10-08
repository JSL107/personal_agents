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
 * 대표 머리 위 말풍선이 고르는 할 일 한 줄.
 *
 * 종류마다 최대 한 줄이라 목록은 3줄을 넘지 않는다. 화면은 그중 **가장 급한 하나**만 말풍선에
 * 넣고 나머지는 "외 N건" 으로 접으므로(앱의 `officePresidentTodoLines`), 여기서는 순서가 곧
 * 급한 순서라는 계약이 중요하다 — 조립 순서(승인 → 실패 → 리뷰)를 바꾸면 화면이 고르는 것도
 * 바뀐다.
 */
export interface ConsoleTodo {
  readonly kind: ConsoleTodoKind;
  /** 말풍선에 그대로 들어가는 문구. 예: '승인 2건', 'PR #1005 리뷰 회수' */
  readonly label: string;
  /** 급한 정도 한 줄. 예: '오늘 19:04 만료', '11일째' */
  readonly detail: string;
  /**
   * 이 할 일이 합쳐 놓은 대상 하나하나. 말풍선은 위의 합친 문구를 쓰고, 대시보드 목록이 대상마다
   * 버튼을 그린다 — 할 일 하나에 id 하나만 실으면 N건 중 한 건만 처리된다.
   *
   * 승인은 대시보드 「승인 대기」가 카드별로 이미 보여 주므로 비워 둔다.
   */
  readonly targets: ConsoleTodoTarget[];
}

/** 할 일 대상 하나. 실패 실행이면 `runId`, PR 리뷰면 `pullNumber`·`url` 이 있다. */
export interface ConsoleTodoTarget {
  /** 목록 한 줄 문구. 예: 'PM', 'JSL107/personal_agents #1005 · 지적 3건' */
  readonly label: string;
  /** 실패 실행의 담당자. 인스펙터가 선택한 담당자의 재시도 대상을 찾을 때 쓴다(라벨은 문구라 키로 쓰지 않는다). */
  readonly agentType?: string;
  readonly runId?: number;
  /**
   * 콘솔 재시도 버튼을 띄워도 되는가 — replay 가 지원하는 종류인지(`REPLAYABLE_AGENT_TYPES`).
   * 참이어도 실행에 따라 서버가 거절할 수 있다(추가 컨텍스트가 붙은 PO_SHADOW 등).
   */
  readonly retryable?: boolean;
  /** 콘솔에서 접수한 재시도가 지금 돌고 있다. 앱은 이 값으로 버튼을 「재시도 중」으로 묶는다. */
  readonly retrying?: boolean;
  readonly pullNumber?: number;
  /** 사람이 직접 열어 처리할 곳. PR 리뷰 회수는 지적마다 판정이 필요해 링크까지만 준다. */
  readonly url?: string;
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
