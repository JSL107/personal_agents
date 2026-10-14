import { toTaskLabel } from '../../agent-registry/agent-registry';
import { DispatchResult } from './idaeri-router.port';

// 이 dispatch 가 원장에 남긴 AgentRun id — 본 실행 다음 핸드오프 순서. 0 은 run 을 남기지 않은
// 분기(결정론·UNKNOWN)의 sentinel 이라 뺀다. 응답 문구의 `agentRunId=` 꼬리표를 소비자가 파싱하지
// 않게 구조화 필드로 넘기는 용도다 — 문구는 생산자가 바꾸는 순간 조용히 깨진다.
export const collectDispatchRunIds = (result: DispatchResult): number[] =>
  [
    result.agentRunId,
    ...(result.handoffResults ?? []).map((handoff) => handoff.agentRunId),
  ].filter((agentRunId) => agentRunId > 0);

export const buildDispatchReplyText = (result: DispatchResult): string => {
  const handoffs = result.handoffResults ?? [];
  if (result.agentRunId === 0 && handoffs.length === 0) {
    return result.formattedText;
  }
  if (handoffs.length === 0) {
    return `${result.formattedText}\n\n_이대리 (${toTaskLabel(result.workerType)}) · 실행 #${result.agentRunId}_`;
  }
  const bodies = [
    result.formattedText,
    ...handoffs.map((handoff) => handoff.formattedText),
  ];
  const workerSequence = [
    result.workerType,
    ...handoffs.map((handoff) => handoff.workerType),
  ]
    .map(toTaskLabel)
    .join(' → ');
  const agentRunIds = [
    result.agentRunId,
    ...handoffs.map((handoff) => handoff.agentRunId),
  ]
    .map((agentRunId) => `#${agentRunId}`)
    .join(', ');
  return [
    bodies.join('\n\n---\n\n'),
    `_이대리 연속 처리 — ${workerSequence} · 실행 ${agentRunIds}_`,
  ].join('\n\n');
};
