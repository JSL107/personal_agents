import { BeChainOutcome } from '../../agent/cto/domain/cto.type';

// CTO 분배 확정 후 실행된 BE chain 결과를 Slack mrkdwn 으로.
// 건별 status 를 아이콘으로 구분해 "몇 건이 실제로 됐는지" 를 한눈에 보이게 한다 —
// 전부 성공했다는 뭉뚱그린 요약보다, 건너뛴 항목과 그 사유가 사용자에게 필요한 정보다.
const STATUS_ICON: Record<BeChainOutcome['status'], string> = {
  OK: '✅',
  SKIPPED: '⏭️',
  FAILED: '❌',
};

export const formatBeChainOutcomes = (outcomes: BeChainOutcome[]): string => {
  if (outcomes.length === 0) {
    return '실행할 분배가 없습니다.';
  }
  const okCount = outcomes.filter((outcome) => outcome.status === 'OK').length;
  const lines: string[] = [
    `*🚀 BE chain 실행 완료 — ${okCount}/${outcomes.length}건 성공*`,
    '',
  ];
  for (const outcome of outcomes) {
    lines.push(
      `${STATUS_ICON[outcome.status]} \`[${outcome.assignment.beAssignment}]\` ${outcome.assignment.taskTitle} — ${outcome.message}`,
    );
  }
  const runIds = outcomes
    .map((outcome) => outcome.agentRunId)
    .filter((agentRunId): agentRunId is number => agentRunId !== undefined);
  if (runIds.length > 0) {
    lines.push('');
    lines.push(
      `_각 run 은 \`/retry-run <id>\` 로 재실행 가능 — agentRunIds=[${runIds.join(', ')}]_`,
    );
  }
  return lines.join('\n');
};
