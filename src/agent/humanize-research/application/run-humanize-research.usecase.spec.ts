import { readFile } from 'node:fs/promises';

import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  CollectionStatus,
  HumanizeResearchSource,
} from '../domain/humanize-research.type';
import { ArxivAbstractCollector } from '../infrastructure/collectors/arxiv-abstract.collector';
import { BlogRevisionCollector } from '../infrastructure/collectors/blog-revision.collector';
import { HumanizerSignalsCollector } from '../infrastructure/collectors/humanizer-signals.collector';
import { UpstreamRuleDiffCollector } from '../infrastructure/collectors/upstream-rule-diff.collector';
import { ModelSampleCollector } from '../infrastructure/model-sample.collector';
import { RunHumanizeResearchUsecase } from './run-humanize-research.usecase';

jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));

const empty = (source: HumanizeResearchSource) => ({
  source,
  status: CollectionStatus.EMPTY,
  items: [],
});

describe('RunHumanizeResearchUsecase', () => {
  const runCallback = jest.fn();
  const recordModelResponse = jest.fn();
  const agentRun = {
    findRecentSucceededRuns: jest.fn().mockResolvedValue([]),
    execute: jest.fn(async ({ run }) => {
      const execution = await run({ recordModelResponse });
      runCallback(execution);
      return { result: execution.result };
    }),
  };
  const modelRouter = { route: jest.fn() };
  const config = {
    get: jest.fn().mockReturnValue('~/.claude/skills/humanize-korean'),
  };
  const humanizer = { collect: jest.fn() };
  const blog = { collect: jest.fn() };
  const upstream = { collect: jest.fn() };
  const arxiv = { collect: jest.fn() };
  const samples = { collect: jest.fn() };
  const usecase = new RunHumanizeResearchUsecase(
    agentRun as unknown as AgentRunService,
    modelRouter as unknown as ModelRouterUsecase,
    config as unknown as ConfigService,
    humanizer as unknown as HumanizerSignalsCollector,
    blog as unknown as BlogRevisionCollector,
    upstream as unknown as UpstreamRuleDiffCollector,
    arxiv as unknown as ArxivAbstractCollector,
    samples as unknown as ModelSampleCollector,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    agentRun.findRecentSucceededRuns.mockResolvedValue([]);
    humanizer.collect.mockResolvedValue(
      empty(HumanizeResearchSource.HUMANIZER),
    );
    blog.collect.mockResolvedValue(empty(HumanizeResearchSource.BLOG));
    upstream.collect.mockResolvedValue(empty(HumanizeResearchSource.UPSTREAM));
    arxiv.collect.mockResolvedValue(empty(HumanizeResearchSource.ARXIV));
    samples.collect.mockResolvedValue(empty(HumanizeResearchSource.SAMPLE));
    jest.mocked(readFile).mockResolvedValue('quick rules');
    modelRouter.route.mockResolvedValue({
      text: '{"proposals":[],"injectionNotices":[]}',
      modelUsed: 'codex',
    });
  });

  it('모든 출처가 비면 모델을 호출하지 않고 출처 상태를 기록한다', async () => {
    const result = await usecase.execute();
    expect(result.skippedForNoSources).toBe(true);
    expect(result.output.sources).toHaveLength(5);
    expect(modelRouter.route).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('한 출처가 실패해도 나머지 자료로 제안하고 실패 사유를 남긴다', async () => {
    blog.collect.mockRejectedValue(new Error('blog unavailable'));
    samples.collect.mockResolvedValue({
      source: HumanizeResearchSource.SAMPLE,
      status: CollectionStatus.OK,
      items: [
        {
          id: 'sample:CHATGPT:work-journal',
          source: HumanizeResearchSource.SAMPLE,
          text: 'sample prose',
        },
      ],
    });
    const result = await usecase.execute();
    expect(result.output.sources[1]).toMatchObject({
      status: CollectionStatus.FAILED,
      error: 'blog unavailable',
    });
    expect(modelRouter.route).toHaveBeenCalledTimes(1);
    expect(result.output.proposals).toEqual([]);
  });
});
