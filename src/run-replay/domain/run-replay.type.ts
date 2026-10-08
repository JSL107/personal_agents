// 실패한 실행을 같은 입력으로 다시 돌리는 일(replay)의 도메인 값.
//
// Slack `/retry-run` 과 콘솔 재시도 버튼이 같은 판정을 쓰도록 전송 계층과 떼어 둔다.
// 두 진입점이 각자 판정하면 한쪽에만 새 종류가 붙어 버튼이 뜨는데 눌러지지 않는 일이 생긴다.

/**
 * 재실행을 지원하는 agentType. 콘솔 브리핑은 이 목록에 든 실패에만 재시도 버튼을 띄운다.
 *
 * 들어 있어도 실행마다 거절될 수 있다 — 추가 컨텍스트가 붙은 PO_SHADOW, 영상 정보가 없는
 * VIDEO_WATCH, 이미 주문을 남긴 PAPER_RECOMMEND 는 `NOT_REPRODUCIBLE` 로 끊긴다.
 */
export const REPLAYABLE_AGENT_TYPES = [
  'PM',
  'WORK_REVIEWER',
  'CODE_REVIEWER',
  'IMPACT_REPORTER',
  'PO_SHADOW',
  'PO_EVAL',
  'CEO',
  'VIDEO_WATCH',
  'PAPER_RECOMMEND',
  'BLOG_PUBLISH',
] as const;

export type ReplayableAgentType = (typeof REPLAYABLE_AGENT_TYPES)[number];

export const isReplayableAgentType = (
  agentType: string,
): agentType is ReplayableAgentType =>
  (REPLAYABLE_AGENT_TYPES as readonly string[]).includes(agentType);

export enum ReplayRejectionCode {
  /** 실행이 없거나 FAILED 가 아니다. */
  NOT_FOUND = 'RUN_REPLAY_NOT_FOUND',
  /** inputSnapshot 이 객체가 아니다. */
  INVALID_SNAPSHOT = 'RUN_REPLAY_INVALID_SNAPSHOT',
  /** 다른 사용자의 실행이다. */
  FORBIDDEN = 'RUN_REPLAY_FORBIDDEN',
  /** 종류 자체가 재실행 개념이 없다 — 안내 문구가 다른 경로를 알려 준다. */
  NOT_SUPPORTED = 'RUN_REPLAY_NOT_SUPPORTED',
  /** 지원 종류지만 이 실행은 같은 입력을 되살릴 수 없거나 다시 돌리면 중복이 생긴다. */
  NOT_REPRODUCIBLE = 'RUN_REPLAY_NOT_REPRODUCIBLE',
  /** 처음 보는 agentType. */
  UNKNOWN_AGENT_TYPE = 'RUN_REPLAY_UNKNOWN_AGENT_TYPE',
  /** 같은 실행의 재시도가 이미 돌고 있다(콘솔 전용). */
  IN_FLIGHT = 'RUN_REPLAY_IN_FLIGHT',
}

export interface ReplayRejection {
  readonly kind: 'REJECTED';
  readonly code: ReplayRejectionCode;
  /** 사용자에게 그대로 보여 줄 문구. Slack 과 콘솔이 같은 문장을 쓴다. */
  readonly message: string;
}
