import { DispatchResult } from './idaeri-router.port';

export const buildDispatchReplyText = (result: DispatchResult): string => {
  const handoffs = result.handoffResults ?? [];
  if (result.agentRunId === 0 && handoffs.length === 0) {
    return result.formattedText;
  }
  if (handoffs.length === 0) {
    return `${result.formattedText}\n\n_이대리 (${result.workerType}) · agentRunId=${result.agentRunId}_`;
  }
  const bodies = [
    result.formattedText,
    ...handoffs.map((handoff) => handoff.formattedText),
  ];
  const workerSequence = [
    result.workerType,
    ...handoffs.map((handoff) => handoff.workerType),
  ].join(' → ');
  const agentRunIds = [
    result.agentRunId,
    ...handoffs.map((handoff) => handoff.agentRunId),
  ].join(', ');
  return [
    bodies.join('\n\n---\n\n'),
    `_이대리 chain — ${workerSequence} · agentRunIds=[${agentRunIds}]_`,
  ].join('\n\n');
};
