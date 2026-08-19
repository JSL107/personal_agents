/**
 * 콘솔(macOS 관제 앱)이 소비하는 뷰 타입의 단일 소스(SoT).
 *
 * 백엔드 내부 도메인 타입(AgentRunStatus 3종 등)을 그대로 노출하지 않고, 화면이 요구하는
 * 형태로 가공한 결과만 담는다. Swift `Codable` 구조체가 이 타입을 그대로 반영한다(계약).
 * 콘솔 API 는 읽기·알림 전용이라, 이 타입들에는 부작용을 유발하는 필드가 없다.
 */

/** 화면에 표시되는 에이전트 상태 6종. Notion 심화편 팔레트에 대응. */
export enum ConsoleAgentState {
  /** 완료 — 민트 */
  COMPLETED = 'COMPLETED',
  /** 진행 중 — 노랑 */
  IN_PROGRESS = 'IN_PROGRESS',
  /** 승인 대기 — 진한 핑크 (대표 결정 대기) */
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  /** 연동 대기 — 라벤더 (외부 자료/연동 부재로 멈춤) */
  AWAITING_INTEGRATION = 'AWAITING_INTEGRATION',
  /** 대기 — 흰색 (앞 단계를 기다림) */
  WAITING = 'WAITING',
  /** 실패 — 빨강/코랄 (직전 실행이 오류로 종료) */
  FAILED = 'FAILED',
}

/** 부서 그리드의 카드 하나. agent-registry 엔트리 + 파생 상태. */
export interface ConsoleAgent {
  readonly agentType: string;
  readonly displayName: string;
  readonly slashCommands: readonly string[];
  readonly description: string;
  readonly state: ConsoleAgentState;
  /** 상태별 말풍선 문구(백엔드가 소유, 앱은 표시만). */
  readonly bubble: string;
  /**
   * 소속 부서(`agent-contract.ts` 가 단일 소스) 와 한글 표시명, 그리고 맡은 일 한 줄.
   *
   * 콘솔(Swift)은 아직 자체 하드코딩 매핑(`Department.swift`)을 쓴다. 이 필드를
   * 소비하도록 전환하는 작업은 4단계이며, 그때까지 부서 정의가 두 곳에 존재하는 것은
   * 의도된 일시적 중복이다.
   */
  readonly department: string;
  readonly departmentLabel: string;
  readonly job: string;
  /**
   * 최근 종료 창 안에 끝난 런의 id. 창 밖이거나 기록이 없으면 null.
   *
   * 앱이 "이 완료는 이미 눈으로 확인했다" 를 기억하는 키다. 같은 값이면 확인한 그 완료라
   * 대기로 내려두고, 새 런이 끝나 값이 바뀌면 다시 완료로 표시한다. 활성 런 목록(`runs`)에는
   * 종료된 런이 담기지 않아 앱이 완료를 식별할 방법이 없었고, 그래서 이 필드가 필요하다.
   *
   * 종료 시각을 쓰지 않는 이유는 `RecentlyFinishedRun.runId` 주석에 있다 — DB 기록과 SSE
   * 발행이 시각을 각각 생성해 같은 런에서도 값이 어긋난다.
   */
  readonly lastFinishedRunId: string | null;
  /**
   * 오늘(KST 자정 이후) 성공으로 끝낸 실행 건수. 오피스 화면이 이 값을 책상 위 서류
   * 더미 높이로 옮긴다 — 숫자를 읽지 않아도 어느 방이 오늘 바빴는지 보이게 하는 것이 목적이다.
   *
   * 경계는 서버 timezone 이 아니라 KST 다(`getKstDayStartAsUtc`). 프로세스 로컬 자정을 쓰면
   * TZ 가 UTC 인 환경에서 KST 00:00~08:59 에 끝난 실행이 오늘 집계에서 빠진다.
   *
   * 실패는 세지 않는다. 실패는 이미 상태 링(빨강)과 엎드린 자세로 표현되므로, 두 신호가
   * 같은 축에서 싸우지 않게 한다.
   *
   * 롤링 24시간이 아니라 자정 기준인 이유는 화면이 하루 단위로 읽히게 하기 위함이다 —
   * 아침에는 전원 책상이 비었다가 하루가 갈수록 쌓이고 자정에 비워진다.
   */
  readonly doneToday: number;
}

/** 진행/최근 에이전트 실행 한 건. `parentId` 로 체인 계보 추적. */
export interface ConsoleRun {
  readonly id: string;
  readonly agentType: string;
  readonly status: string;
  readonly parentId: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

/** PreviewGate 승인 대기 한 건. */
export interface ConsoleApproval {
  readonly id: string;
  readonly agentType: string | null;
  readonly title: string;
  readonly createdAt: string;
  /**
   * 이 카드가 만료되는 시각(ISO 8601).
   *
   * 화면이 방치 압력을 **경과 시간이 아니라 TTL 소진 비율**로 계산하기 때문에 필요하다.
   * TTL 은 카드 종류마다 다르므로(`ttlMs`), 만료 시각 없이는 "2시간 지났다" 가 급한 것인지
   * 여유가 있는 것인지 화면이 구분할 수 없다.
   *
   * DB 컬럼(`preview_action.expires_at`)은 원래부터 있었고 만료 스윕이 그것으로 조회한다.
   * 이 필드는 그 값을 화면까지 통과시키는 것뿐이라 스키마 변경이 없다.
   */
  readonly expiresAt: string;
}

/** 로컬에서 실행 중인 CLI 세션 한 건(관제 뷰 표현). 읽기 전용. */
export interface ConsoleSession {
  readonly sessionId: string;
  readonly pid: number;
  readonly source: 'claude' | 'codex';
  readonly name: string;
  readonly cwd: string;
  readonly state: 'active' | 'idle';
  readonly startedAt: string;
  readonly lastActivityAt: string | null;
}

/** 앱 부팅 시 1콜로 받는 전체 상태 스냅샷. */
export interface ConsoleSnapshot {
  readonly agents: ConsoleAgent[];
  readonly runs: ConsoleRun[];
  readonly approvals: ConsoleApproval[];
  readonly sessions: ConsoleSession[];
  readonly serverTime: string;
}

/** SSE 로 흘려보내는 증분 이벤트. 앱은 이걸 스냅샷 위에 적용한다. */
export type ConsoleEvent =
  | { readonly type: 'run.started' | 'run.finished'; readonly run: ConsoleRun }
  | {
      readonly type: 'approval.opened' | 'approval.resolved';
      readonly approval: ConsoleApproval;
    }
  | {
      readonly type: 'state.changed';
      readonly agentType: string;
      readonly state: ConsoleAgentState;
    }
  | {
      readonly type: 'session.opened' | 'session.updated';
      readonly session: ConsoleSession;
    }
  | { readonly type: 'session.closed'; readonly sessionId: string }
  | {
      readonly type: 'command.rejected';
      readonly commandId: string;
      readonly reason: string;
    }
  | {
      readonly type: 'command.info';
      readonly commandId: string;
      readonly message: string;
    }
  | {
      readonly type: 'command.answered';
      readonly commandId: string;
      readonly message: string;
    };
