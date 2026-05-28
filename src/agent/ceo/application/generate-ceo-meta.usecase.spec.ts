import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { CeoException } from '../domain/ceo.exception';
import { CeoErrorCode } from '../domain/ceo-error-code.enum';
import { MAX_PHASE_OUTPUT_BYTES } from '../domain/prompt/ceo-system.prompt';
import { GenerateCeoMetaUsecase } from './generate-ceo-meta.usecase';

const validLlmJson = JSON.stringify({
  contextDriftReport: {
    observations: ['PM plan 의 의도와 BE 실행 결과 불일치 1건'],
  },
  docsQualityReport: {
    findings: ['CLAUDE.md §1 표 갱신 — CEO 추가 필요'],
  },
  finalSummary: '본 주는 phase 흐름 정상, drift 1건 + 문서 갱신 1건.',
});

const phaseRun = (
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

describe('GenerateCeoMetaUsecase', () => {
  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let agentRunServiceFindRecent: jest.Mock;
  let usecase: GenerateCeoMetaUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 63 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 63,
      };
    });
    agentRunServiceFindRecent = jest.fn(async ({ agentType }) => {
      if (agentType === AgentType.PO_EVAL) {
        return [phaseRun(201, { finalSummary: 'po_eval output' })];
      }
      if (agentType === AgentType.PM) {
        return [phaseRun(202, { plan: 'pm output' })];
      }
      if (agentType === AgentType.CTO) {
        return [phaseRun(203, { assignments: [] })];
      }
      return [];
    });

    usecase = new GenerateCeoMetaUsecase(
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

  it('PO_EVAL run 없으면 NO_PO_EVAL_RUN 예외 (WEEK)', async () => {
    agentRunServiceFindRecent.mockResolvedValue([]);
    await expect(
      usecase.execute({ slackUserId: 'U1', range: 'WEEK' }),
    ).rejects.toMatchObject({
      ceoErrorCode: CeoErrorCode.NO_PO_EVAL_RUN,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('PO_EVAL run 없으면 NO_PO_EVAL_RUN 예외 (TODAY)', async () => {
    agentRunServiceFindRecent.mockResolvedValue([]);
    await expect(
      usecase.execute({ slackUserId: 'U1', range: 'TODAY' }),
    ).rejects.toBeInstanceOf(CeoException);
  });

  it('range 미지정 시 WEEK default — findRecentSucceededRuns sinceDays=7', async () => {
    await usecase.execute({ slackUserId: 'U1' });
    for (const call of agentRunServiceFindRecent.mock.calls) {
      expect(call[0].sinceDays).toBe(7);
      expect(call[0].limit).toBe(1);
      expect(call[0].slackUserId).toBe('U1');
    }
  });

  it('range=TODAY — findRecentSucceededRuns sinceDays=1', async () => {
    await usecase.execute({ slackUserId: 'U1', range: 'TODAY' });
    for (const call of agentRunServiceFindRecent.mock.calls) {
      expect(call[0].sinceDays).toBe(1);
    }
  });

  it('PM/CTO 없어도 PO_EVAL 만 있으면 graceful — sourcePhaseRuns 부분 매핑', async () => {
    agentRunServiceFindRecent.mockImplementation(async ({ agentType }) => {
      if (agentType === AgentType.PO_EVAL) {
        return [phaseRun(201, {})];
      }
      return [];
    });
    const outcome = await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    expect(outcome.result.sourcePhaseRuns).toEqual({
      poEvalRunId: 201,
      pmRunId: undefined,
      ctoRunId: undefined,
    });
  });

  it('모델 응답을 MetaOutput 으로 합성 — range/sourcePhaseRuns/schemaVersion 은 manager 가 채움', async () => {
    const outcome = await usecase.execute({
      slackUserId: 'U1',
      range: 'WEEK',
    });
    expect(outcome.result.range).toBe('WEEK');
    expect(outcome.result.schemaVersion).toBe(1);
    expect(outcome.result.sourcePhaseRuns).toEqual({
      poEvalRunId: 201,
      pmRunId: 202,
      ctoRunId: 203,
    });
    expect(outcome.result.contextDriftReport.observations).toHaveLength(1);
    expect(outcome.result.docsQualityReport.findings).toHaveLength(1);
    expect(outcome.result.finalSummary).toContain('drift 1건');
    expect(outcome.modelUsed).toBe('claude-cli');
    expect(outcome.agentRunId).toBe(63);
  });

  it('AgentRunService 에 CEO + SLACK_COMMAND_CEO_REVIEW + 3 evidence 전달', async () => {
    await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.CEO);
    expect(call.triggerType).toBe('SLACK_COMMAND_CEO_REVIEW');
    expect(call.inputSnapshot).toMatchObject({
      slackUserId: 'U1',
      range: 'WEEK',
      poEvalRunId: 201,
      pmRunId: 202,
      ctoRunId: 203,
    });
    expect(call.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'CEO_META_SOURCE_PO_EVAL',
          sourceId: '201',
        }),
        expect.objectContaining({
          sourceType: 'CEO_META_SOURCE_PM',
          sourceId: '202',
        }),
        expect.objectContaining({
          sourceType: 'CEO_META_SOURCE_CTO',
          sourceId: '203',
        }),
      ]),
    );
    expect(call.evidence).toHaveLength(3);
  });

  it('PM/CTO 없으면 evidence 도 PO_EVAL 만 1건', async () => {
    agentRunServiceFindRecent.mockImplementation(async ({ agentType }) => {
      if (agentType === AgentType.PO_EVAL) {
        return [phaseRun(201, {})];
      }
      return [];
    });
    await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.evidence).toHaveLength(1);
    expect(call.evidence[0].sourceType).toBe('CEO_META_SOURCE_PO_EVAL');
  });

  it('prompt 에 3 phase label + range 헤더 포함', async () => {
    await usecase.execute({ slackUserId: 'U1', range: 'TODAY' });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('[range] TODAY');
    expect(promptArg).toContain('[PO_EVAL 직전 output]');
    expect(promptArg).toContain('[PM 직전 plan]');
    expect(promptArg).toContain('[CTO 직전 분배]');
    expect(promptArg).toContain('[합성 지시]');
  });

  it('빠진 PM/CTO 섹션은 "(없음 — phase run 미존재)" 표시', async () => {
    agentRunServiceFindRecent.mockImplementation(async ({ agentType }) => {
      if (agentType === AgentType.PO_EVAL) {
        return [phaseRun(201, { finalSummary: 'po_eval only' })];
      }
      return [];
    });
    await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('[PM 직전 plan] (없음 — phase run 미존재)');
    expect(promptArg).toContain('[CTO 직전 분배] (없음 — phase run 미존재)');
  });

  it('phase output 이 MAX_PHASE_OUTPUT_BYTES 초과 시 truncate suffix 부착', async () => {
    const large = 'x'.repeat(MAX_PHASE_OUTPUT_BYTES + 500);
    agentRunServiceFindRecent.mockImplementation(async ({ agentType }) => {
      if (agentType === AgentType.PO_EVAL) {
        return [phaseRun(201, large)];
      }
      return [];
    });
    await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('생략됨 — phase output cap');
    expect(promptArg.length).toBeLessThan(large.length);
  });

  it('모델 응답이 schema 와 안 맞으면 CeoException 으로 throw', async () => {
    modelRouter.route.mockResolvedValue({
      text: '{"contextDriftReport": "not-an-object"}',
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });
    await expect(
      usecase.execute({ slackUserId: 'U1', range: 'WEEK' }),
    ).rejects.toBeInstanceOf(CeoException);
  });

  it('phase 조회는 Promise.all 로 병렬 — PO_EVAL/PM/CTO 3종 호출', async () => {
    await usecase.execute({ slackUserId: 'U1', range: 'WEEK' });
    expect(agentRunServiceFindRecent).toHaveBeenCalledTimes(3);
    const agentTypes = agentRunServiceFindRecent.mock.calls.map(
      (call) => call[0].agentType,
    );
    expect(agentTypes).toEqual(
      expect.arrayContaining([AgentType.PO_EVAL, AgentType.PM, AgentType.CTO]),
    );
  });
});
