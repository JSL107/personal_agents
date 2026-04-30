import { Logger } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { FileAnalysis } from '../domain/be-test.type';
import { BeTestErrorCode } from '../domain/be-test-error-code.enum';
import { JestMockGenerator } from '../infrastructure/jest-mock-generator';
import { TreeSitterTestAnalyzer } from '../infrastructure/tree-sitter-test-analyzer';
import { GenerateTestUsecase } from './generate-test.usecase';

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  realpath: jest.fn(),
}));

import * as fs from 'node:fs/promises';

const mockFs = fs as jest.Mocked<typeof fs>;

const FAKE_SOURCE = `
export class FooService {
  constructor(private readonly fooPort: FooPort) {}
  async doWork(input: string): Promise<string> {
    if (!input) { return 'empty'; }
    return this.fooPort.fetch(input);
  }
}
`;

const FAKE_ANALYSIS: FileAnalysis = {
  filePath: '/repo/src/foo/foo.service.ts',
  className: 'FooService',
  ports: [
    {
      paramName: 'fooPort',
      typeName: 'FooPort',
      isInjectToken: false,
    },
  ],
  functions: [
    {
      name: 'doWork',
      startLine: 4,
      endLine: 7,
      branches: [
        {
          kind: 'if',
          startLine: 5,
          endLine: 5,
          condition: '!input',
        },
      ],
      parameters: [{ name: 'input', type: 'string' }],
      isAsync: true,
    },
  ],
  cyclomaticComplexity: 2,
  rawSource: FAKE_SOURCE,
};

const FAKE_SPEC_CODE = `
import { FooService } from './foo.service';
describe('FooService', () => {
  it('should work', () => { expect(true).toBe(true); });
});
`;

const REPO_ROOT = process.cwd();

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
      text: JSON.stringify({ specCode: FAKE_SPEC_CODE }),
      modelUsed: 'mock-model',
      provider: 'CLAUDE',
    }),
  }) as unknown as jest.Mocked<ModelRouterUsecase>;

const makeAnalyzerMock = (): jest.Mocked<TreeSitterTestAnalyzer> =>
  ({
    analyze: jest.fn().mockReturnValue(FAKE_ANALYSIS),
  }) as unknown as jest.Mocked<TreeSitterTestAnalyzer>;

const makeMockGeneratorMock = (): jest.Mocked<JestMockGenerator> =>
  ({
    generateMocks: jest.fn().mockReturnValue('// mock setup'),
  }) as unknown as jest.Mocked<JestMockGenerator>;

const buildUsecase = (
  overrides: {
    modelRouter?: jest.Mocked<ModelRouterUsecase>;
    agentRunService?: jest.Mocked<AgentRunService>;
    analyzer?: jest.Mocked<TreeSitterTestAnalyzer>;
    mockGenerator?: jest.Mocked<JestMockGenerator>;
  } = {},
): {
  usecase: GenerateTestUsecase;
  modelRouter: jest.Mocked<ModelRouterUsecase>;
  agentRunService: jest.Mocked<AgentRunService>;
  analyzer: jest.Mocked<TreeSitterTestAnalyzer>;
  mockGenerator: jest.Mocked<JestMockGenerator>;
} => {
  const modelRouter = overrides.modelRouter ?? makeModelRouterMock();
  const agentRunService =
    overrides.agentRunService ?? makeAgentRunServiceMock();
  const analyzer = overrides.analyzer ?? makeAnalyzerMock();
  const mockGenerator = overrides.mockGenerator ?? makeMockGeneratorMock();

  const usecase = new GenerateTestUsecase(
    modelRouter,
    agentRunService,
    analyzer,
    mockGenerator,
  );

  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  return { usecase, modelRouter, agentRunService, analyzer, mockGenerator };
};

describe('GenerateTestUsecase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFile.mockResolvedValue(FAKE_SOURCE as unknown as never);
    // realpath: process.cwd() / target 모두 동일 경로로 통과시킴 (default).
    mockFs.realpath.mockImplementation(
      async (target) => target as unknown as string,
    );
  });

  it('빈 filePath 이면 BeTestException(EMPTY_PATH) 을 던진다', async () => {
    const { usecase } = buildUsecase();

    await expect(
      usecase.execute({ filePath: '  ', slackUserId: 'U123' }),
    ).rejects.toMatchObject({
      beTestErrorCode: BeTestErrorCode.EMPTY_PATH,
    });
  });

  it('filePath 에 .. 가 포함되면 BeTestException(INVALID_PATH) 를 던진다', async () => {
    const { usecase } = buildUsecase();

    await expect(
      usecase.execute({ filePath: '../etc/passwd', slackUserId: 'U123' }),
    ).rejects.toMatchObject({
      beTestErrorCode: BeTestErrorCode.INVALID_PATH,
    });
  });

  it('파일이 존재하지 않으면 BeTestException(FILE_NOT_FOUND) 를 던진다', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    const { usecase } = buildUsecase();

    await expect(
      usecase.execute({
        filePath: 'src/foo/foo.service.ts',
        slackUserId: 'U123',
      }),
    ).rejects.toMatchObject({
      beTestErrorCode: BeTestErrorCode.FILE_NOT_FOUND,
    });
  });

  it('symlink resolution 결과가 repo 밖을 가리키면 INVALID_PATH (codex P2)', async () => {
    mockFs.realpath.mockImplementation(async (target) => {
      const t = target as unknown as string;
      if (t === REPO_ROOT) {
        return REPO_ROOT;
      }
      // 대상 파일은 /etc/passwd 로 symlink 됐다고 가정.
      return '/etc/passwd';
    });
    const { usecase } = buildUsecase();

    await expect(
      usecase.execute({
        filePath: 'src/foo/foo.service.ts',
        slackUserId: 'U123',
      }),
    ).rejects.toMatchObject({
      beTestErrorCode: BeTestErrorCode.INVALID_PATH,
    });
  });

  it('정상 경로 — LLM 응답을 spec 으로 반환 (validated:false)', async () => {
    const { usecase } = buildUsecase();

    const outcome = await usecase.execute({
      filePath: 'src/foo/foo.service.ts',
      slackUserId: 'U123',
    });

    expect(outcome.result.specCode).toContain('describe');
    expect(outcome.result.validated).toBe(false);
  });

  it('agentRunService.execute 에 올바른 agentType/triggerType 이 전달된다', async () => {
    const agentRunService = makeAgentRunServiceMock();
    const { usecase } = buildUsecase({ agentRunService });

    await usecase.execute({
      filePath: 'src/foo/foo.service.ts',
      slackUserId: 'U123',
      triggerType: TriggerType.SLACK_COMMAND_BE_TEST,
    });

    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.BE_TEST,
        triggerType: TriggerType.SLACK_COMMAND_BE_TEST,
      }),
    );
  });
});
