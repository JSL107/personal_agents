import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import {
  CollectionStatus,
  HumanizeResearchSource,
} from '../domain/humanize-research.type';
import { ModelSampleCollector } from './model-sample.collector';

interface RouteInput {
  provider: ModelProviderName;
}

const buildRouter = (): { route: jest.Mock } => ({
  route: jest
    .fn()
    .mockImplementation(({ provider }: RouteInput) =>
      Promise.resolve({ text: '표본 본문', modelUsed: provider, provider }),
    ),
});

const countCalls = ({
  router,
  provider,
}: {
  router: { route: jest.Mock };
  provider: ModelProviderName;
}): number =>
  router.route.mock.calls.filter(
    ([input]: [RouteInput]) => input.provider === provider,
  ).length;

describe('ModelSampleCollector', () => {
  it('두 provider에서 고정 주제 3개씩 라우터를 거쳐 수집한다', async () => {
    const router = buildRouter();
    const result = await new ModelSampleCollector(
      router as unknown as ModelRouterUsecase,
    ).collect();

    expect(result.status).toBe(CollectionStatus.OK);
    expect(result.items.map((item) => item.id)).toEqual([
      'sample:CHATGPT:development-retrospective',
      'sample:CHATGPT:technical-explanation',
      'sample:CHATGPT:work-journal',
      'sample:CLAUDE:development-retrospective',
      'sample:CLAUDE:technical-explanation',
      'sample:CLAUDE:work-journal',
    ]);
    expect(
      result.items.every(
        (item) => item.source === HumanizeResearchSource.SAMPLE,
      ),
    ).toBe(true);
    expect(countCalls({ router, provider: ModelProviderName.CHATGPT })).toBe(3);
    expect(countCalls({ router, provider: ModelProviderName.CLAUDE })).toBe(3);
    // 머리말·fallback 이 끼면 provider 별 원문 표본이 아니게 된다.
    expect(router.route).toHaveBeenCalledWith({
      agentType: AgentType.HUMANIZE_RESEARCH,
      provider: ModelProviderName.CLAUDE,
      noFallback: true,
      noContractPreamble: true,
      request: {
        systemPrompt: expect.any(String),
        prompt: expect.stringContaining('800자'),
      },
    });
  });

  it('한 표본이 실패해도 나머지를 만들고 실패 이유를 남긴다', async () => {
    const router = buildRouter();
    router.route.mockRejectedValueOnce(new Error('quota'));

    const result = await new ModelSampleCollector(
      router as unknown as ModelRouterUsecase,
    ).collect();

    expect(result.status).toBe(CollectionStatus.FAILED);
    expect(result.items).toHaveLength(5);
    expect(result.error).toContain('CHATGPT:development-retrospective: quota');
    expect(countCalls({ router, provider: ModelProviderName.CLAUDE })).toBe(3);
  });
});
