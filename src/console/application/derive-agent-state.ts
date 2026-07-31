import { ConsoleAgentState } from '../domain/console.type';

/**
 * 상태 6종 파생의 입력 신호.
 *
 * 백엔드 `AgentRunStatus` 는 3종(IN_PROGRESS/SUCCEEDED/FAILED)뿐이라, 화면이 요구하는
 * 6종은 승인 대기·연동 차단·큐 대기 신호를 합쳐 파생한다. 순수 함수로 유지해 규칙과
 * 우선순위를 유닛 테스트로 고정한다.
 */
export interface DeriveInput {
  /** 이 에이전트/런에 열린 PreviewGate 승인 건이 있는가. */
  readonly hasOpenApproval: boolean;
  /** IN_PROGRESS 런이 있는가. */
  readonly hasActiveRun: boolean;
  /** 가장 최근에 종료된 런의 상태(없으면 null). */
  readonly latestFinishedStatus: 'SUCCEEDED' | 'FAILED' | null;
  /** 외부 연동/자료 부재로 멈춰 있는가(v1 은 보수적으로 판별). */
  readonly isIntegrationBlocked: boolean;
  /** 앞 단계를 기다리며 큐에 있는가. */
  readonly isQueuedWaiting: boolean;
}

/**
 * 우선순위: 승인대기 > 연동대기 > 진행중 > 대기 > 실패 > 완료.
 *
 * 애매하면 `WAITING` 으로 강등해 과표시를 막는다.
 */
export function deriveAgentState(input: DeriveInput): ConsoleAgentState {
  if (input.hasOpenApproval) {
    return ConsoleAgentState.AWAITING_APPROVAL;
  }
  if (input.isIntegrationBlocked) {
    return ConsoleAgentState.AWAITING_INTEGRATION;
  }
  if (input.hasActiveRun) {
    return ConsoleAgentState.IN_PROGRESS;
  }
  if (input.isQueuedWaiting) {
    return ConsoleAgentState.WAITING;
  }
  if (input.latestFinishedStatus === 'FAILED') {
    return ConsoleAgentState.FAILED;
  }
  if (input.latestFinishedStatus === 'SUCCEEDED') {
    return ConsoleAgentState.COMPLETED;
  }
  return ConsoleAgentState.WAITING;
}

const BUBBLES: Record<ConsoleAgentState, string> = {
  [ConsoleAgentState.COMPLETED]: '완료했어요!',
  [ConsoleAgentState.IN_PROGRESS]: '일하는 중…',
  [ConsoleAgentState.AWAITING_APPROVAL]: '확인해주세요',
  [ConsoleAgentState.AWAITING_INTEGRATION]: '연결 기다려요',
  [ConsoleAgentState.WAITING]: '업무 대기중',
  [ConsoleAgentState.FAILED]: '문제가 생겼어요',
};

/** 상태별 말풍선 문구. 앱은 이 문구를 그대로 표시한다. */
export function bubbleForState(state: ConsoleAgentState): string {
  return BUBBLES[state];
}
