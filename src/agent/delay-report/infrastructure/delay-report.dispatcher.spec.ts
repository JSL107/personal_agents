import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import { BuildDelayReportUsecase } from '../application/build-delay-report.usecase';
import { DelayReportDispatcher } from './delay-report.dispatcher';

describe('DelayReportDispatcher', () => {
  it('결정론 조회도 AgentRun 을 남기고 그 id 를 돌려준다', async () => {
    const buildDelayReport = {
      execute: jest.fn().mockResolvedValue({
        primaryCause: 'NONE',
        detail: '',
        secondaryNotes: [],
        unavailableAxes: [],
        unverifiedHigherPriority: [],
        inconclusiveNotes: [],
      }),
    } as unknown as BuildDelayReportUsecase;
    const agentRunService = {
      execute: jest.fn(async ({ run }) => ({
        ...(await run({})),
        agentRunId: 7,
      })),
    };
    const dispatcher = new DelayReportDispatcher(
      buildDelayReport,
      agentRunService as never,
    );
    const input: DispatchInput = {
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      agentTypeHint: AgentType.DELAY_REPORT,
    };

    const outcome = await dispatcher.dispatch(input);

    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.DELAY_REPORT,
        triggerType: 'SLACK_MENTION_DELAY_REPORT',
      }),
    );
    expect(outcome.agentRunId).toBe(7);
    expect(outcome.modelUsed).toBe('deterministic');
    expect(outcome.formattedText).toContain('지연 없습니다');
  });
});
