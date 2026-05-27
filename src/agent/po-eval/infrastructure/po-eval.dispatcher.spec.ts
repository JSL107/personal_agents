import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import { GeneratePoEvaluationUsecase } from '../application/generate-po-evaluation.usecase';
import { EvaluationOutput } from '../domain/po-eval.type';
import { PoEvalDispatcher } from './po-eval.dispatcher';

const sampleOutput: EvaluationOutput = {
  range: 'WEEK',
  sourceAgentRuns: {
    workReviewerRunId: 101,
    poShadowRunId: 102,
    impactReporterRunId: 103,
  },
  qualitative: {
    summary: '한 주를 마무리 — Router 도입.',
    blockers: ['Codex 쿼터 모니터링'],
    wins: ['Router scaffold 합의'],
  },
  careerLog: {
    schemaVersion: 1,
    period: '2026-W21',
    achievements: {
      quantitative: ['PR 3건 머지'],
      qualitative: ['Hierarchical Manager Pattern 도입'],
    },
    technologies: ['NestJS', 'Prisma'],
    impact: '봇 자연어 진입 통합.',
  },
};

const baseInput: DispatchInput = {
  source: 'SLACK_COMMAND',
  slackUserId: 'U1',
};

describe('PoEvalDispatcher', () => {
  let usecaseExecute: jest.Mock;
  let dispatcher: PoEvalDispatcher;

  beforeEach(() => {
    usecaseExecute = jest.fn().mockResolvedValue({
      result: sampleOutput,
      modelUsed: 'claude-cli',
      agentRunId: 73,
    });
    dispatcher = new PoEvalDispatcher({
      execute: usecaseExecute,
    } as unknown as GeneratePoEvaluationUsecase);
  });

  it('agentType 은 PO_EVAL', () => {
    expect(dispatcher.agentType).toBe(AgentType.PO_EVAL);
  });

  it('dispatch 는 GeneratePoEvaluationUsecase.execute 에 slackUserId 만 위임 (range 미전달 → usecase default WEEK)', async () => {
    await dispatcher.dispatch(baseInput);
    expect(usecaseExecute).toHaveBeenCalledTimes(1);
    expect(usecaseExecute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    // range 명시 args 본 dispatcher 미지원 — 슬래시 핸들러가 별도 처리.
    expect(usecaseExecute.mock.calls[0][0]).not.toHaveProperty('range');
  });

  it('outcome 을 DispatchOutcome 형태로 매핑 (agentRunId/output/modelUsed/formattedText)', async () => {
    const outcome = await dispatcher.dispatch(baseInput);
    expect(outcome.agentRunId).toBe(73);
    expect(outcome.output).toBe(sampleOutput);
    expect(outcome.modelUsed).toBe('claude-cli');
    expect(typeof outcome.formattedText).toBe('string');
    expect(outcome.formattedText.length).toBeGreaterThan(0);
    // formatEvaluationOutput 출력 — period / 한 주 요약 포함.
    expect(outcome.formattedText).toContain('2026-W21');
  });

  it('contextRefs / agentTypeHint 등 다른 input 필드는 무시 (slackUserId 만 사용)', async () => {
    await dispatcher.dispatch({
      ...baseInput,
      contextRefs: { agentRunId: 999 },
      agentTypeHint: AgentType.PO_EVAL,
      text: '이번 주 평가 좀',
    });
    expect(usecaseExecute).toHaveBeenCalledWith({ slackUserId: 'U1' });
  });

  it('usecase 가 throw 하면 dispatcher 도 그대로 propagate', async () => {
    const error = new Error('NO_SUB_AGENT_RUNS');
    usecaseExecute.mockRejectedValue(error);
    await expect(dispatcher.dispatch(baseInput)).rejects.toBe(error);
  });
});
