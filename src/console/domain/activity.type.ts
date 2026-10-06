export interface ConsoleActivityDay {
  /** KST 날짜(YYYY-MM-DD). */
  readonly date: string;
  readonly succeeded: number;
  readonly failed: number;
  /** 아직 진행 중이거나 종료 상태가 기록되지 않은 실행. */
  readonly other: number;
}

export interface ConsoleRecentRun {
  readonly id: string;
  readonly agentType: string;
  readonly status: string;
  /** 무엇을 했는지 한 줄. 규칙이 없는 계기면 자동/직접 구분만 남는다. */
  readonly title: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  /** 연달아 같은 일·같은 결과로 끝난 실행을 한 줄로 묶은 수(1이면 단건). 시각은 가장 최근 것. */
  readonly count: number;
}

export interface ConsoleActivity {
  /** 오래된 날부터 오늘까지, 실행이 없던 날도 0으로 채운다. */
  readonly days: readonly ConsoleActivityDay[];
  /** 시작 시각 최신순. */
  readonly recentRuns: readonly ConsoleRecentRun[];
  readonly serverTime: string;
}
