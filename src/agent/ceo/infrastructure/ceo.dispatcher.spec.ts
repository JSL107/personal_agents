import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import { GenerateCeoMetaUsecase } from '../application/generate-ceo-meta.usecase';
import { MetaOutput } from '../domain/ceo.type';
import { CeoDispatcher } from './ceo.dispatcher';

const sampleOutput: MetaOutput = {
  range: 'WEEK',
  sourcePhaseRuns: {
    poEvalRunId: 201,
    pmRunId: 202,
    ctoRunId: 203,
  },
  contextDriftReport: { observations: ['drift 신호 1건'] },
  docsQualityReport: { findings: ['CLAUDE.md 갱신'] },
  finalSummary: '본 주는 phase 흐름 정상.',
  schemaVersion: 1,
};

const baseInput: DispatchInput = {
  source: 'SLACK_COMMAND',
  slackUserId: 'U1',
};

describe('CeoDispatcher', () => {
  let usecaseExecute: jest.Mock;
  let dispatcher: CeoDispatcher;

  beforeEach(() => {
    usecaseExecute = jest.fn().mockResolvedValue({
      result: sampleOutput,
      modelUsed: 'claude-cli',
      agentRunId: 84,
    });
    dispatcher = new CeoDispatcher({
      execute: usecaseExecute,
    } as unknown as GenerateCeoMetaUsecase);
  });

  it('agentType 은 CEO', () => {
    expect(dispatcher.agentType).toBe(AgentType.CEO);
  });

  it('dispatch 는 GenerateCeoMetaUsecase.execute 에 slackUserId 만 위임 (range 미전달 → usecase default WEEK)', async () => {
    await dispatcher.dispatch(baseInput);
    expect(usecaseExecute).toHaveBeenCalledTimes(1);
    expect(usecaseExecute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    expect(usecaseExecute.mock.calls[0][0]).not.toHaveProperty('range');
  });

  it('outcome 을 DispatchOutcome 형태로 매핑 (agentRunId/output/modelUsed/formattedText)', async () => {
    const outcome = await dispatcher.dispatch(baseInput);
    expect(outcome.agentRunId).toBe(84);
    expect(outcome.output).toBe(sampleOutput);
    expect(outcome.modelUsed).toBe('claude-cli');
    expect(typeof outcome.formattedText).toBe('string');
    expect(outcome.formattedText.length).toBeGreaterThan(0);
    expect(outcome.formattedText).toContain('드리프트');
  });

  it('contextRefs / agentTypeHint / text 등 다른 input 필드는 무시', async () => {
    await dispatcher.dispatch({
      ...baseInput,
      contextRefs: { agentRunId: 999 },
      agentTypeHint: AgentType.CEO,
      text: '이번 주 메타 평가',
    });
    expect(usecaseExecute).toHaveBeenCalledWith({ slackUserId: 'U1' });
  });

  it('usecase 가 throw 하면 dispatcher 도 그대로 propagate', async () => {
    const error = new Error('NO_PO_EVAL_RUN');
    usecaseExecute.mockRejectedValue(error);
    await expect(dispatcher.dispatch(baseInput)).rejects.toBe(error);
  });
});
