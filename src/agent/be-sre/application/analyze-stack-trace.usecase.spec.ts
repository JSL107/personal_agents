import { Logger } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { BuildCodeGraphUsecase } from '../../../code-graph/application/build-code-graph.usecase';
import { CodeGraphQueryUsecase } from '../../../code-graph/application/code-graph-query.usecase';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { BeSreErrorCode } from '../domain/be-sre-error-code.enum';
import { AnalyzeStackTraceUsecase } from './analyze-stack-trace.usecase';

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue('// source preview'),
  // codex P1 fix — usecase 가 realpath 로 repo 안 검증을 하므로 mock 필요. identity.
  realpath: jest.fn().mockImplementation(async (p: string) => p),
}));

const FAKE_STACK = `Error: something went wrong
    at FooService.doWork (/repo/src/foo/foo.service.ts:42:15)
    at BarController.handle (/repo/src/bar/bar.controller.ts:10:5)`;

const FAKE_LLM_RESPONSE = JSON.stringify({
  rootCauseHypothesis: 'null 참조일 가능성이 높음',
  patchProposal: '```typescript\nconst x = value ?? default;\n```',
  reasoning: 'FooService.doWork 에서 종료됨',
});

const makeAgentRunServiceMock = (): jest.Mocked<AgentRunService> =>
  ({
    execute: jest.fn().mockImplementation(async ({ run }) => {
      const execution = await run({ agentRunId: 1 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 1,
      };
    }),
    findLatestSucceededRun: jest.fn(),
    findRecentSucceededRuns: jest.fn(),
    findSimilarPlans: jest.fn(),
  }) as unknown as jest.Mocked<AgentRunService>;

const makeModelRouterMock = (): jest.Mocked<ModelRouterUsecase> =>
  ({
    route: jest.fn().mockResolvedValue({
      text: FAKE_LLM_RESPONSE,
      modelUsed: 'mock-model',
      provider: 'CLAUDE',
    }),
  }) as unknown as jest.Mocked<ModelRouterUsecase>;

const makeBuildCodeGraphMock = (
  fail = false,
): jest.Mocked<BuildCodeGraphUsecase> =>
  ({
    execute: fail
      ? jest.fn().mockRejectedValue(new Error('tree-sitter init failed'))
      : jest.fn().mockResolvedValue({
          version: 1,
          rootDir: '/repo/src',
          builtAt: new Date().toISOString(),
          chunks: [],
          relations: [],
        }),
  }) as unknown as jest.Mocked<BuildCodeGraphUsecase>;

const makeCodeGraphQueryMock = (): jest.Mocked<CodeGraphQueryUsecase> =>
  ({
    findCallersOf: jest
      .fn()
      .mockReturnValue([
        { filePath: '/repo/src/caller/caller.service.ts', line: 5 },
      ]),
    findFilesAffectedByImport: jest.fn().mockReturnValue([]),
    findImplementersOf: jest.fn().mockReturnValue([]),
    findExtendersOf: jest.fn().mockReturnValue([]),
  }) as unknown as jest.Mocked<CodeGraphQueryUsecase>;

const buildUsecase = (
  overrides: {
    modelRouter?: jest.Mocked<ModelRouterUsecase>;
    agentRunService?: jest.Mocked<AgentRunService>;
    buildCodeGraph?: jest.Mocked<BuildCodeGraphUsecase>;
    codeGraphQuery?: jest.Mocked<CodeGraphQueryUsecase>;
  } = {},
): {
  usecase: AnalyzeStackTraceUsecase;
  modelRouter: jest.Mocked<ModelRouterUsecase>;
  agentRunService: jest.Mocked<AgentRunService>;
  buildCodeGraph: jest.Mocked<BuildCodeGraphUsecase>;
  codeGraphQuery: jest.Mocked<CodeGraphQueryUsecase>;
} => {
  const modelRouter = overrides.modelRouter ?? makeModelRouterMock();
  const agentRunService =
    overrides.agentRunService ?? makeAgentRunServiceMock();
  const buildCodeGraph = overrides.buildCodeGraph ?? makeBuildCodeGraphMock();
  const codeGraphQuery = overrides.codeGraphQuery ?? makeCodeGraphQueryMock();

  const usecase = new AnalyzeStackTraceUsecase(
    modelRouter,
    agentRunService,
    buildCodeGraph,
    codeGraphQuery,
  );

  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  return {
    usecase,
    modelRouter,
    agentRunService,
    buildCodeGraph,
    codeGraphQuery,
  };
};

describe('AnalyzeStackTraceUsecase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('빈 stack trace 이면 BeSreException(EMPTY_STACK_TRACE) 를 던진다', async () => {
    const { usecase } = buildUsecase();

    await expect(
      usecase.execute({ stackTrace: '   ', slackUserId: 'U123' }),
    ).rejects.toMatchObject({
      beSreErrorCode: BeSreErrorCode.EMPTY_STACK_TRACE,
    });
  });

  it('파싱 가능한 TS frame 이 0개이면 BeSreException(NO_TS_FRAMES_FOUND) 를 던진다', async () => {
    const { usecase } = buildUsecase();

    await expect(
      usecase.execute({
        stackTrace:
          'Error: oops\n    at Object.<anonymous> (/repo/node_modules/express/lib/router.js:100:5)',
        slackUserId: 'U123',
      }),
    ).rejects.toMatchObject({
      beSreErrorCode: BeSreErrorCode.NO_TS_FRAMES_FOUND,
    });
  });

  it('Code Graph build 실패 시 affectedFiles 는 frames 의 filePath 만 담고 분석을 완료한다', async () => {
    const { usecase } = buildUsecase({
      buildCodeGraph: makeBuildCodeGraphMock(true),
    });

    const outcome = await usecase.execute({
      stackTrace: FAKE_STACK,
      slackUserId: 'U123',
    });

    expect(outcome.result.frames).toHaveLength(2);
    // node_modules 없이 graceful — filePath 2개
    expect(outcome.result.affectedFiles).toHaveLength(2);
  });

  it('Code Graph snapshot 있을 때 frames + caller 들이 affectedFiles 에 포함된다', async () => {
    const { usecase, codeGraphQuery } = buildUsecase();

    const outcome = await usecase.execute({
      stackTrace: FAKE_STACK,
      slackUserId: 'U123',
    });

    // findCallersOf 가 호출됨
    expect(codeGraphQuery.findCallersOf).toHaveBeenCalled();
    // frame 파일 2개 + caller 파일 1개 = 3개 (단 caller 가 frame 파일 중 하나와 겹칠 수 있어 ≥2)
    expect(outcome.result.affectedFiles.length).toBeGreaterThanOrEqual(2);
    expect(outcome.result.rootCauseHypothesis).toBe(
      'null 참조일 가능성이 높음',
    );
  });

  it('LLM JSON 파싱 실패 시 parseError:true 이고 원문이 patchProposal 에 보존된다', async () => {
    const modelRouter = makeModelRouterMock();
    modelRouter.route.mockResolvedValue({
      text: '이것은 JSON 이 아닌 응답입니다.',
      modelUsed: 'mock-model',
      provider: 'CLAUDE' as never,
    });
    const { usecase } = buildUsecase({ modelRouter });

    const outcome = await usecase.execute({
      stackTrace: FAKE_STACK,
      slackUserId: 'U123',
    });

    expect(outcome.result.parseError).toBe(true);
    expect(outcome.result.patchProposal).toBe(
      '이것은 JSON 이 아닌 응답입니다.',
    );
  });

  it('agentRunService.execute 에 올바른 agentType/triggerType 이 전달된다', async () => {
    const agentRunService = makeAgentRunServiceMock();
    const { usecase } = buildUsecase({ agentRunService });

    await usecase.execute({
      stackTrace: FAKE_STACK,
      slackUserId: 'U123',
      triggerType: TriggerType.SLACK_COMMAND_BE_SRE,
    });

    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.BE_SRE,
        triggerType: TriggerType.SLACK_COMMAND_BE_SRE,
      }),
    );
  });
});
