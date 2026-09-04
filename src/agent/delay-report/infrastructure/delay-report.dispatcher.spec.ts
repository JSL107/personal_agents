import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import { BuildDelayReportUsecase } from '../application/build-delay-report.usecase';
import { DelayReportDispatcher } from './delay-report.dispatcher';

describe('DelayReportDispatcher', () => {
  it('결정론 조회 결과는 run 0과 deterministic을 반환한다', async () => {
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
    const dispatcher = new DelayReportDispatcher(buildDelayReport);
    const input: DispatchInput = {
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      agentTypeHint: AgentType.DELAY_REPORT,
    };

    const outcome = await dispatcher.dispatch(input);

    expect(outcome.agentRunId).toBe(0);
    expect(outcome.modelUsed).toBe('deterministic');
    expect(outcome.formattedText).toContain('지연 없습니다');
  });
});
