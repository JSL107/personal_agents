export type ConsoleAgentAutonomy =
  | 'AUTONOMOUS'
  | 'ON_DEMAND'
  | 'EVENT_DRIVEN'
  | 'NEVER_RUN';

export interface LedgerClock {
  /** 집계 기준 KST 날짜(YYYY-MM-DD). */
  readonly today: string;
  /** 응답 생성 기준 시각(ISO 8601). */
  readonly serverTime: string;
}

export interface ConsoleAgentLedger {
  readonly agentType: string;
  /** 첫 실행 KST 날짜(YYYY-MM-DD). 실행 기록 없으면 null. */
  readonly firstRunDate: string | null;
  readonly totalRuns: number;
  readonly failedRuns: number;
  /** 마지막 실행 시각(ISO 8601). 없으면 null. */
  readonly lastRunAt: string | null;
  readonly autonomy: ConsoleAgentAutonomy;
  /** 자율 워커가 기대 주기를 넘겨 멈췄는가. 자율이 아니면 항상 false. */
  readonly stalled: boolean;
  /** 마지막 실행 KST 날짜부터 오늘까지 경과 일수. 실행 기록 없으면 null. */
  readonly idleDays: number | null;
}

export interface ConsoleCompanyLedger {
  /** 회사 전체 첫 실행 KST 날짜. 원장이 비면 null. */
  readonly foundedDate: string | null;
  /** 창립일부터 오늘까지 일수 + 1 (창립일 당일 = 1일차). 원장이 비면 0. */
  readonly ageDays: number;
  readonly totalRuns: number;
  readonly failedRuns: number;
  /** 이번 주 월요일(KST)부터 오늘까지. */
  readonly thisWeekRuns: number;
  /** 지난주 월요일부터 지난주 같은 요일까지 (같은 일수 비교). */
  readonly lastWeekRunsToSameWeekday: number;
}

export interface ConsoleLedger {
  readonly agents: readonly ConsoleAgentLedger[];
  readonly company: ConsoleCompanyLedger;
  readonly serverTime: string;
}
