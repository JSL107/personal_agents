import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationTurn } from '../domain/conversation-memory.type';

// 자연어 질문 eval 의 문항·실행 기록·채점 결과 타입.
// (plan: docs/superpowers/plans/2026-10-07-nl-answer-fidelity.md §4 1단계)

export type EvalSplit = 'tuning' | 'holdout';

// 답이 나온 곳. 워커가 답했으면 그 AgentType, 담당을 못 골라 대화 답변이 나갔으면 REPLIED.
export type EvalDestination = AgentType | 'REPLIED';

export interface EvalExpect {
  // 허용하는 답의 출처. 생략하면 출처는 채점하지 않는다.
  destinations?: EvalDestination[];
  // 쓰기·외부 실행(휴가 등록, PR 리뷰 실행 등)이 시도되면 실패.
  forbidIntercepts?: boolean;
  // 이 가로채기가 반드시 일어나야 한다(평서 등록 대조군, PR 후속 승계). argsInclude 는 부분 일치.
  mustIntercept?: { name: string; argsInclude?: Record<string, unknown> };
  mustMatch?: RegExp[];
  mustNotMatch?: RegExp[];
  // 되묻기로 끝나면 실패 — 마지막 문장이 물음표로 끝나는지 본다.
  notEndWithQuestion?: boolean;
  // 직전 봇 응답과 같은 문장을 되풀이하면 실패.
  differFromPriorBot?: boolean;
}

export interface EvalCase {
  id: string;
  split: EvalSplit;
  // 문항이 왜 있는지 — holdout 은 원문 출처(날짜·점검 문서 판정).
  note: string;
  text: string;
  priorTurns?: ConversationTurn[];
  expect: EvalExpect;
}

// 쓰기·외부 실행 usecase 를 가로챈 기록. 실제로는 아무것도 실행되지 않았다.
export interface EvalIntercept {
  name: string;
  args: Record<string, unknown>;
}

export type EvalOutcomeKind =
  // 워커가 끝까지 돌아 답했다.
  | 'WORKER_RAN'
  // 분류기가 담당을 못 골라 대화 답변이 나갔다.
  | 'REPLIED'
  // 워커가 쓰기·외부 실행 직전까지 갔다(가로채서 실행하지 않음).
  | 'INTERCEPTED'
  // eval 에서 실행하지 않는 무거운 워커로 라우팅됐다(PM·회고 등).
  | 'STUB_ROUTED'
  // 사용자에게 오류가 나갔을 회차.
  | 'ERROR';

export interface EvalModelCall {
  agentType: string;
  responseText: string;
}

export interface EvalRunRecord {
  caseId: string;
  split: EvalSplit;
  runIndex: number;
  outcome: EvalOutcomeKind;
  destination?: EvalDestination;
  // 사용자가 보게 될 텍스트(오류면 오류 문구).
  text?: string;
  intercepts: EvalIntercept[];
  // 분류기·워커 파서의 원응답 — 가드 이전의 파서 판단을 여기서 복원한다.
  modelCalls: EvalModelCall[];
  durationMs: number;
}

export interface EvalScore {
  pass: boolean;
  failures: string[];
}
