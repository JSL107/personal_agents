import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { FinishedRunDigest } from '../../agent-run/domain/port/agent-run.repository.port';
import { AgentType } from '../../model-router/domain/model-router.type';

// 후처리·내부 판정의 성공은 사용자에게 알릴 작업 결과가 아니다. 실패는 별도로 알린다.
export const MASCOT_QUIET_SUCCESS_AGENT_TYPES: readonly AgentType[] = [
  AgentType.HUMANIZER,
  AgentType.REVIEW_REPLY_JUDGE,
  AgentType.SUBCONSCIOUS_GATE,
];

export const isNoteworthyRun = (run: FinishedRunDigest): boolean => {
  if (run.status === 'FAILED') {
    return true;
  }

  if (
    MASCOT_QUIET_SUCCESS_AGENT_TYPES.some(
      (agentType) => agentType === run.agentType,
    )
  ) {
    return false;
  }

  if (
    run.agentType === AgentType.PAPER_TRADE &&
    run.triggerType === TriggerType.AUTOPILOT_PAPER_INTRADAY_STOP_CRON
  ) {
    return false;
  }

  return true;
};
