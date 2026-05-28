import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { PoEvalException } from '../domain/po-eval.exception';
import { PoEvalErrorCode } from '../domain/po-eval-error-code.enum';
import { MAX_SUB_AGENT_OUTPUT_BYTES } from '../domain/prompt/po-eval-system.prompt';
import { GeneratePoEvaluationUsecase } from './generate-po-evaluation.usecase';

const validLlmJson = JSON.stringify({
  qualitative: {
    summary: '한 주를 마무리하며 Router 도입 + careerLog 신설.',
    blockers: ['Codex 쿼터 모니터링 미흡'],
    wins: ['Router scaffold 합의', 'PO_EVAL facade 머지'],
  },
  careerLog: {
    schemaVersion: 1,
    period: '2026-W21',
    achievements: {
      quantitative: ['PR 3건 머지', 'spec 7개 추가'],
      qualitative: ['Hierarchical Manager Pattern 도입'],
    },
    technologies: ['NestJS', 'Prisma', 'Slack Bolt'],
    impact: '봇 자연어 진입을 통합해 슬래시 의존도 감소.',
  },
});

const baseRun = (
  id: number,
  output: unknown,
): {
  id: number;
  output: unknown;
  endedAt: Date;
} => ({
  id,
  output,
  endedAt: new Date('2026-05-20T05:00:00Z'),
});

describe('GeneratePoEvaluationUsecase', () => {
  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let agentRunServiceFindRecent: jest.Mock;
  let usecase: GeneratePoEvaluationUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 51 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 51,
      };
    });
    agentRunServiceFindRecent = jest.fn(async ({ agentType }) => {
      if (agentType === AgentType.WORK_REVIEWER) {
        return [baseRun(101, { summary: 'wr output' })];
      }
      if (agentType === AgentType.PO_SHADOW) {
        return [baseRun(102, { report: 'pos output' })];
      }
      if (agentType === AgentType.IMPACT_REPORTER) {
        return [baseRun(103, { impact: 'ir output' })];
      }
      return [];
    });

    usecase = new GeneratePoEvaluationUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      {
        execute: agentRunServiceExecute,
        findRecentSucceededRuns: agentRunServiceFindRecent,
      } as unknown as AgentRunService,
    );

    modelRouter.route.mockResolvedValue({
      text: validLlmJson,
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    } satisfies CompletionResponse);
  });

  it('3 sub-agent run 모두 없으면 NO_SUB_AGENT_RUNS 예외 (WEEK)', async () => {
    agentRunServiceFindRecent.mockResolvedValue([]);
    await expect(
      usecase.execute({ slackUserId: 'U1', range: 'WEEK' }),
    ).rejects.toMatchObject({
      poEvalErrorCode: PoEvalErrorCode.NO_SUB_AGENT_RUNS,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('3 sub-agent run 모두 없으면 NO_SUB_AGENT_RUNS 예외 (TODAY)', async () => {
    agentRunServiceFindRecent.mockResolvedValue([]);
    await expect(
      usecase.execute({ slackUserId: 'U1', range: 'TODAY' }),
    ).rejects.toBeInstanceOf(PoEvalException);
  });

  it('range 미지정 시 WEEK default — findRecentSucceededRuns sinceDays=7', async () => {
    await usecase.execute({ slackUserId: 'U1' });
    const callsByAgent = new Map<AgentType, number>();
    for (const call of agentRunServiceFindRecent.mock.calls) {
      callsByAgent.set(call[0].agentType, call[0].sinceDays);
    }
    expect(callsByAgent.get(AgentType.WORK_REVIEWER)).toBe(7);
    expect(callsByAgent.get(AgentType.PO_SHADOW)).toBe(7);
    expect(callsByAgent.get(AgentType.IMPACT_REPORTER)).toBe(7);
  });

  it('range=TODAY — findRecentSucceededRuns sinceDays=1', async () => {
    await usecase.execute({ slackUserId: 'U1', range: 'TODAY' });
    for (const call of agentRunServiceFindRecent.mock.calls) {
      expect(call[0].sinceDays).toBe(1);
      expect(call[0].limit).toBe(1);
      expect(call[0].slackUserId).toBe('U1');
    }
  });

  it('일부 sub-agent run 만 있어도 graceful — work_reviewer 만 있을 때 정상', async () => {
    agentRunServiceFindRecent.mockImplementation(async ({ agentType }) => {
      if (agentType === AgentType.WORK_REVIEWER) {
        return [baseRun(101, { summary: 'wr only' })];
      }
      return [];
    });
    const outcome = await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    expect(outcome.result.sourceAgentRuns).toEqual({
      workReviewerRunId: 101,
      poShadowRunId: undefined,
      impactReporterRunId: undefined,
    });
  });

  it('모델 응답을 EvaluationOutput 으로 합성 — sourceAgentRuns/range 는 manager 가 채움', async () => {
    const outcome = await usecase.execute({
      slackUserId: 'U1',
      range: 'WEEK',
    });
    expect(outcome.result.range).toBe('WEEK');
    expect(outcome.result.sourceAgentRuns).toEqual({
      workReviewerRunId: 101,
      poShadowRunId: 102,
      impactReporterRunId: 103,
    });
    expect(outcome.result.qualitative.summary).toContain('Router 도입');
    expect(outcome.result.careerLog.schemaVersion).toBe(1);
    expect(outcome.result.careerLog.period).toBe('2026-W21');
    expect(outcome.modelUsed).toBe('claude-cli');
    expect(outcome.agentRunId).toBe(51);
  });

  it('AgentRunService 에 PO_EVAL + SLACK_COMMAND_PO_EVAL + 3 evidence 전달', async () => {
    await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.PO_EVAL);
    expect(call.triggerType).toBe('SLACK_COMMAND_PO_EVAL');
    expect(call.inputSnapshot).toMatchObject({
      slackUserId: 'U1',
      range: 'WEEK',
      workReviewerRunId: 101,
      poShadowRunId: 102,
      impactReporterRunId: 103,
    });
    expect(call.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'PO_EVAL_SOURCE_WORK_REVIEWER',
          sourceId: '101',
        }),
        expect.objectContaining({
          sourceType: 'PO_EVAL_SOURCE_PO_SHADOW',
          sourceId: '102',
        }),
        expect.objectContaining({
          sourceType: 'PO_EVAL_SOURCE_IMPACT_REPORTER',
          sourceId: '103',
        }),
      ]),
    );
    expect(call.evidence).toHaveLength(3);
  });

  it('일부 sub-agent 만 있으면 evidence 도 그만큼만 추가', async () => {
    agentRunServiceFindRecent.mockImplementation(async ({ agentType }) => {
      if (agentType === AgentType.WORK_REVIEWER) {
        return [baseRun(101, {})];
      }
      return [];
    });
    await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.evidence).toHaveLength(1);
    expect(call.evidence[0].sourceType).toBe('PO_EVAL_SOURCE_WORK_REVIEWER');
  });

  it('prompt 에 3 sub-agent label + range 헤더 포함', async () => {
    await usecase.execute({ slackUserId: 'U1', range: 'TODAY' });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('[range] TODAY');
    expect(promptArg).toContain('[Work Reviewer 직전 output]');
    expect(promptArg).toContain('[PO Shadow 직전 output]');
    expect(promptArg).toContain('[Impact Reporter 직전 output]');
    expect(promptArg).toContain('[합성 지시]');
  });

  it('빠진 sub-agent 섹션은 "(없음 — sub-agent 미실행)" 표시', async () => {
    agentRunServiceFindRecent.mockImplementation(async ({ agentType }) => {
      if (agentType === AgentType.WORK_REVIEWER) {
        return [baseRun(101, { summary: 'wr only' })];
      }
      return [];
    });
    await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain(
      '[PO Shadow 직전 output] (없음 — sub-agent 미실행)',
    );
    expect(promptArg).toContain(
      '[Impact Reporter 직전 output] (없음 — sub-agent 미실행)',
    );
  });

  it('sub-agent output 이 MAX_SUB_AGENT_OUTPUT_BYTES 초과 시 truncate suffix 부착', async () => {
    const large = 'x'.repeat(MAX_SUB_AGENT_OUTPUT_BYTES + 500);
    agentRunServiceFindRecent.mockImplementation(async ({ agentType }) => {
      if (agentType === AgentType.WORK_REVIEWER) {
        return [baseRun(101, large)];
      }
      return [];
    });
    await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('생략됨 — sub-agent output cap');
    // 전체 prompt 가 raw output 길이 그대로는 아님.
    expect(promptArg.length).toBeLessThan(large.length);
  });

  it('모델 응답이 schema 와 안 맞으면 PoEvalException 으로 throw', async () => {
    modelRouter.route.mockResolvedValue({
      text: '{"qualitative": "not-an-object"}',
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });
    await expect(
      usecase.execute({ slackUserId: 'U1', range: 'WEEK' }),
    ).rejects.toBeInstanceOf(PoEvalException);
  });

  it('sub-agent 조회는 Promise.all 로 병렬 — 3종 호출 후 결과 매핑', async () => {
    await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    expect(agentRunServiceFindRecent).toHaveBeenCalledTimes(3);
    const agentTypes = agentRunServiceFindRecent.mock.calls.map(
      (call) => call[0].agentType,
    );
    expect(agentTypes).toEqual(
      expect.arrayContaining([
        AgentType.WORK_REVIEWER,
        AgentType.PO_SHADOW,
        AgentType.IMPACT_REPORTER,
      ]),
    );
  });
});
