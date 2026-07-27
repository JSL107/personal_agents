/**
 * 콘솔(macOS 관제 앱)이 소비하는 뷰 타입의 단일 소스(SoT).
 *
 * 백엔드 내부 도메인 타입(AgentRunStatus 3종 등)을 그대로 노출하지 않고, 화면이 요구하는
 * 형태로 가공한 결과만 담는다. Swift `Codable` 구조체가 이 타입을 그대로 반영한다(계약).
 * 콘솔 API 는 읽기·알림 전용이라, 이 타입들에는 부작용을 유발하는 필드가 없다.
 */

/** 화면에 표시되는 에이전트 상태 5종. Notion 심화편 팔레트에 대응. */
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

/** 앱 부팅 시 1콜로 받는 전체 상태 스냅샷. */
export interface ConsoleSnapshot {
  readonly agents: ConsoleAgent[];
  readonly runs: ConsoleRun[];
  readonly approvals: ConsoleApproval[];
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
    };
