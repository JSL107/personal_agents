import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { FinishedRunDigest } from '../../agent-run/domain/port/agent-run.repository.port';
import { AgentType } from '../../model-router/domain/model-router.type';
import { isNoteworthyRun } from './mascot-noteworthy';

describe('isNoteworthyRun', () => {
  const run: FinishedRunDigest = {
    runId: 1,
    agentType: AgentType.PM,
    triggerType: TriggerType.SLACK_COMMAND_TODAY,
    status: 'SUCCEEDED',
    endedAt: new Date('2026-10-21T03:00:00.000Z'),
    summary: null,
  };

  it('실패는 내부 단계나 장중 손절 점검이어도 알린다', () => {
    expect(
      isNoteworthyRun({
        ...run,
        agentType: AgentType.HUMANIZER,
        status: 'FAILED',
      }),
    ).toBe(true);
    expect(
      isNoteworthyRun({
        ...run,
        agentType: AgentType.PAPER_TRADE,
        triggerType: TriggerType.AUTOPILOT_PAPER_INTRADAY_STOP_CRON,
        status: 'FAILED',
      }),
    ).toBe(true);
  });

  it.each([
    AgentType.HUMANIZER,
    AgentType.REVIEW_REPLY_JUDGE,
    AgentType.SUBCONSCIOUS_GATE,
  ])('%s 내부 단계 성공은 알리지 않는다', (agentType) => {
    expect(isNoteworthyRun({ ...run, agentType })).toBe(false);
  });

  it('장중 손절 점검 성공은 알리지 않는다', () => {
    expect(
      isNoteworthyRun({
        ...run,
        agentType: AgentType.PAPER_TRADE,
        triggerType: TriggerType.AUTOPILOT_PAPER_INTRADAY_STOP_CRON,
      }),
    ).toBe(false);
  });

  it('PAPER_TRADE 의 다른 계기와 일반 성공은 알린다', () => {
    expect(
      isNoteworthyRun({
        ...run,
        agentType: AgentType.PAPER_TRADE,
        triggerType: TriggerType.AUTOPILOT_PAPER_TRADING_CRON,
      }),
    ).toBe(true);
    expect(isNoteworthyRun(run)).toBe(true);
  });
});
