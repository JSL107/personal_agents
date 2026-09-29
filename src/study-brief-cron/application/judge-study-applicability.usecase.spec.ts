import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { BuildCodeGraphUsecase } from '../../code-graph/application/build-code-graph.usecase';
import { CodeGraphQueryUsecase } from '../../code-graph/application/code-graph-query.usecase';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import {
  JudgeableStudyBrief,
  StudyBriefRepositoryPort,
} from '../domain/port/study-brief.repository.port';
import { JudgeStudyApplicabilityUsecase } from './judge-study-applicability.usecase';

const brief = (keywords: string[]): JudgeableStudyBrief => ({
  id: 5,
  kind: 'CONCEPT',
  topic: 'Hooks',
  verdict: { kind: 'CONCEPT', whyNow: 'w', whereItLands: 'x', minutes: 15 },
  reportMd: 'r',
  sourceUrls: [],
  createdAt: new Date(),
  keywords,
  notionUrl: 'https://notion.so/p',
});

const setup = (keywords: string[], modelText?: string) => {
  const repository = {
    findOldestUnjudgedSince: jest.fn().mockResolvedValue(brief(keywords)),
    saveApplicability: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<StudyBriefRepositoryPort>;
  const buildCodeGraph = {
    execute: jest.fn().mockResolvedValue({
      version: 1,
      rootDir: '/r',
      builtAt: '',
      relations: [],
      chunks: [
        {
          filePath: 'model-router/a.ts',
          kind: 'function',
          name: 'installStopHook',
          startLine: 1,
          endLine: 2,
          source: '',
        },
      ],
    }),
  } as unknown as BuildCodeGraphUsecase;
  const modelRouter = {
    route: jest.fn().mockResolvedValue({
      text: modelText ?? '',
      modelUsed: 'gpt',
      provider: 'CHATGPT',
    }),
  } as unknown as jest.Mocked<ModelRouterUsecase>;
  const agentRunService = {
    execute: jest.fn().mockImplementation(async ({ run }) => {
      const executed = await run({ updateInputSnapshot: jest.fn() });
      return {
        result: executed.result,
        modelUsed: executed.modelUsed,
        agentRunId: 1,
      };
    }),
  } as unknown as AgentRunService;
  const usecase = new JudgeStudyApplicabilityUsecase(
    repository,
    buildCodeGraph,
    new CodeGraphQueryUsecase(),
    modelRouter,
    agentRunService,
  );
  return { usecase, repository, modelRouter, buildCodeGraph };
};

describe('JudgeStudyApplicabilityUsecase', () => {
  it('대상 브리프가 없으면 empty', async () => {
    const { usecase, repository } = setup([]);
    repository.findOldestUnjudgedSince.mockResolvedValue(undefined);
    await expect(
      usecase.execute({ ownerSlackUserId: 'U1', firedAtKst: '2026-09-30' }),
    ).resolves.toEqual({ status: 'empty' });
  });

  it('키워드가 없으면(배포 전 브리프) 모델·code-graph 없이 NOT_APPLICABLE 로 저장한다', async () => {
    const { usecase, modelRouter, buildCodeGraph, repository } = setup([]);
    const result = await usecase.execute({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-09-30',
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
    expect(buildCodeGraph.execute).not.toHaveBeenCalled();
    expect(repository.saveApplicability).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ verdict: 'NOT_APPLICABLE', rawVerdict: null }),
    );
    expect(result).toMatchObject({ status: 'judged', saved: true });
  });

  it('빈 code-graph 스냅샷은 NOT_APPLICABLE 로 저장하지 않고 재시도를 위해 실패한다', async () => {
    const { usecase, buildCodeGraph, repository, modelRouter } = setup([
      'hook',
    ]);
    buildCodeGraph.execute = jest.fn().mockResolvedValue({
      version: 1,
      rootDir: '/r',
      builtAt: '',
      relations: [],
      chunks: [],
    });
    await expect(
      usecase.execute({ ownerSlackUserId: 'U1', firedAtKst: '2026-09-30' }),
    ).rejects.toThrow(/code-graph 스냅샷이 비어/);
    expect(repository.saveApplicability).not.toHaveBeenCalled();
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('후보가 0개면 모델을 부르지 않는다', async () => {
    const { usecase, modelRouter } = setup(['nothingmatches']);
    const result = await usecase.execute({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-09-30',
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      judgement: { verdict: 'NOT_APPLICABLE' },
    });
  });

  it('후보가 있으면 outputSchema 로 채점하고 재검증 결과를 저장한다', async () => {
    const { usecase, modelRouter, repository } = setup(
      ['hook'],
      '{"verdict":"APPLY","reason":"r","citations":[{"chunkId":"c1","why":"w"}],"proposal":{"title":"t","problem":"p","change":"c","verify":"v"}}',
    );
    const result = await usecase.execute({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-09-30',
    });
    expect(modelRouter.route).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          outputSchema: expect.any(Object),
          prompt: expect.stringContaining('src/model-router/a.ts'),
        }),
      }),
    );
    expect(repository.saveApplicability).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ verdict: 'APPLY' }),
    );
    expect(result).toMatchObject({
      status: 'judged',
      judgement: {
        verdict: 'APPLY',
        citations: [{ filePath: 'src/model-router/a.ts' }],
      },
    });
  });

  it('조건부 저장이 거부되면 saved=false 를 돌려준다', async () => {
    const { usecase, repository } = setup([]);
    repository.saveApplicability.mockResolvedValue(false);
    await expect(
      usecase.execute({ ownerSlackUserId: 'U1', firedAtKst: '2026-09-30' }),
    ).resolves.toMatchObject({ saved: false });
  });

  it('모델 출력이 깨지면 예외를 던지고 저장하지 않는다(다음 날 재시도)', async () => {
    const { usecase, repository } = setup(['hook'], 'not json');
    await expect(
      usecase.execute({ ownerSlackUserId: 'U1', firedAtKst: '2026-09-30' }),
    ).rejects.toThrow();
    expect(repository.saveApplicability).not.toHaveBeenCalled();
  });
});
