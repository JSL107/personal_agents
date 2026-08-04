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
   * 최근 종료 창 안에 끝난 런의 종료 시각(ISO). 창 밖이거나 기록이 없으면 null.
   *
   * 앱이 "이 완료는 이미 눈으로 확인했다" 를 기억하는 키다. 같은 값이면 확인한 그 완료라
   * 대기로 내려두고, 새 런이 끝나 값이 바뀌면 다시 완료로 표시한다. 활성 런 목록(`runs`)에는
   * 종료된 런이 담기지 않아 앱이 완료를 식별할 방법이 없었고, 그래서 이 필드가 필요하다.
   */
  readonly lastFinishedAt: string | null;
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
    };
