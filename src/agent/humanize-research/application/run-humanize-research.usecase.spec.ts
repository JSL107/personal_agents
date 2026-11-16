import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  CollectionStatus,
  HumanizeResearchSource,
  ProposalTarget,
} from '../domain/humanize-research.type';
import { CanonCheckRunner } from '../infrastructure/canon-check.runner';
import { ArxivAbstractCollector } from '../infrastructure/collectors/arxiv-abstract.collector';
import { BlogRevisionCollector } from '../infrastructure/collectors/blog-revision.collector';
import { CanonLogCollector } from '../infrastructure/collectors/canon-log.collector';
import { HumanizerSignalsCollector } from '../infrastructure/collectors/humanizer-signals.collector';
import { UpstreamRuleDiffCollector } from '../infrastructure/collectors/upstream-rule-diff.collector';
import { RunHumanizeResearchUsecase } from './run-humanize-research.usecase';

// 실제 정본(~/.claude/skills/humanize-korean)에 기대지 않는다 — CI 에는 정본이 없다.
const createRulesRepository = (): string => {
  const repository = mkdtempSync(join(tmpdir(), 'humanize-rules-'));
  mkdirSync(join(repository, 'references'));
  writeFileSync(
    join(repository, 'references/quick-rules.md'),
    '| A-9 | "~에 의해" 피동 | S2 | 행위자를 주어로("AI에 의해 생성" → "AI가 만든") |\n## 등급 기준 (자가 채점)',
  );
  return repository;
};

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
  const rulesRepository = createRulesRepository();
  const config = { get: jest.fn().mockReturnValue(rulesRepository) };
  const humanizer = { collect: jest.fn() };
  const blog = { collect: jest.fn() };
  const upstream = { collect: jest.fn() };
  const arxiv = { collect: jest.fn() };
  const canon = { collect: jest.fn() };
  const canonCheck = {
    check: jest.fn().mockResolvedValue({ reason: null, baseSha: 'abc' }),
  };
  const usecase = new RunHumanizeResearchUsecase(
    agentRun as unknown as AgentRunService,
    modelRouter as unknown as ModelRouterUsecase,
    config as unknown as ConfigService,
    humanizer as unknown as HumanizerSignalsCollector,
    blog as unknown as BlogRevisionCollector,
    upstream as unknown as UpstreamRuleDiffCollector,
    arxiv as unknown as ArxivAbstractCollector,
    canon as unknown as CanonLogCollector,
    canonCheck as unknown as CanonCheckRunner,
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
    canon.collect.mockResolvedValue(empty(HumanizeResearchSource.CANON_LOG));
    config.get.mockReturnValue(rulesRepository);
    modelRouter.route.mockResolvedValue({
      text: '{"proposals":[],"injectionNotices":[]}',
      modelUsed: 'codex',
    });
  });

  it('옛 원장 processed(canonHead 없음)는 리셋되지 않는다', async () => {
    agentRun.findRecentSucceededRuns.mockResolvedValue([
      {
        output: {
          processed: {
            humanizerMaxRunId: '1',
            blogPostIds: ['blog:a'],
            upstreamHead: null,
            arxivIds: [],
          },
        },
      },
    ]);
    const result = await usecase.execute();
    expect(result.output.processed).toMatchObject({
      blogPostIds: ['blog:a'],
      canonHead: null,
    });
  });

  it('모든 출처가 비면 모델을 호출하지 않고 출처 상태를 기록한다', async () => {
    const result = await usecase.execute();
    expect(result.skippedForNoSources).toBe(true);
    expect(result.output.sources).toHaveLength(5);
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('한 출처가 실패해도 나머지 자료로 제안하고 실패 사유를 남긴다', async () => {
    blog.collect.mockRejectedValue(new Error('blog unavailable'));
    canon.collect.mockResolvedValue({
      source: HumanizeResearchSource.CANON_LOG,
      status: CollectionStatus.OK,
      items: [
        {
          id: 'canon:abc',
          source: HumanizeResearchSource.CANON_LOG,
          text: 'commit',
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
  it('게이트 실패 제안은 skipped 에 사유와 함께 남기고 상한은 통과분으로 센다', async () => {
    canon.collect.mockResolvedValue({
      source: HumanizeResearchSource.CANON_LOG,
      status: CollectionStatus.OK,
      items: [
        {
          id: 'canon:abc',
          source: HumanizeResearchSource.CANON_LOG,
          text: 'commit',
        },
      ],
    });
    const proposal = {
      target: ProposalTarget.CANON,
      file: 'references/quick-rules.md',
      oldString:
        '| A-9 | "~에 의해" 피동 | S2 | 행위자를 주어로("AI에 의해 생성" → "AI가 만든") |',
      newString: 'changed',
      targetMetric: 'metric',
      rationale: 'reason',
      evidence: ['canon:abc'],
    };
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        proposals: [
          { ...proposal, file: 'bad' },
          proposal,
          proposal,
          proposal,
          proposal,
        ],
        enforcementGaps: [
          {
            ruleId: 'prompt.habit.comma-after-ending',
            evidence: ['canon:abc'],
          },
          { ruleId: 'B', evidence: [] },
          { ruleId: 'C', evidence: ['unknown'] },
        ],
      }),
      modelUsed: 'codex',
    });
    const result = await usecase.execute();
    expect(result.output.enforcementGaps).toEqual([
      { ruleId: 'prompt.habit.comma-after-ending', evidence: ['canon:abc'] },
    ]);
    expect(result.output.proposals).toHaveLength(3);
    expect(result.output.skipped.map((entry) => entry.reason)).toEqual([
      'FILE_NOT_ALLOWED',
      'OVER_LIMIT',
    ]);
  });
  it('정본 검사 실패와 예외는 skipped 에 기록하고 블로그는 검사하지 않는다', async () => {
    canon.collect.mockResolvedValue({
      source: HumanizeResearchSource.CANON_LOG,
      status: CollectionStatus.OK,
      items: [
        {
          id: 'canon:abc',
          source: HumanizeResearchSource.CANON_LOG,
          text: 'commit',
        },
      ],
    });
    const proposal = {
      target: ProposalTarget.CANON,
      file: 'references/quick-rules.md',
      oldString:
        '| A-9 | "~에 의해" 피동 | S2 | 행위자를 주어로("AI에 의해 생성" → "AI가 만든") |',
      newString: 'changed',
      targetMetric: 'metric',
      rationale: 'reason',
      evidence: ['canon:abc'],
    };
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        proposals: [proposal, proposal],
        enforcementGaps: [],
        injectionNotices: [],
      }),
      modelUsed: 'codex',
    });
    canonCheck.check
      .mockResolvedValueOnce({ reason: 'SELFCHECK_FAILED', baseSha: 'abc' })
      .mockRejectedValueOnce(new Error('failed'));
    const result = await usecase.execute();
    expect(result.output.proposals).toEqual([]);
    expect(result.output.skipped.map((entry) => entry.reason)).toEqual([
      'SELFCHECK_FAILED',
      'CANON_CHECK_ERROR',
    ]);
  });
  it('블로그 제안은 정본 검사를 건너뛰고 baseSha 를 null 로 둔다', async () => {
    blog.collect.mockResolvedValue({
      source: HumanizeResearchSource.BLOG,
      status: CollectionStatus.OK,
      items: [
        { id: 'blog:1', source: HumanizeResearchSource.BLOG, text: '근거' },
      ],
    });
    const proposal = {
      target: ProposalTarget.BLOG,
      file: 'src/humanize/domain/humanize-system.prompt.ts',
      oldString:
        '  - "~에 의해" 피동 → 행위자를 주어로("AI에 의해 생성된" → "AI가 만든")',
      newString: '새 문구',
      targetMetric: 'metric',
      rationale: 'reason',
      evidence: ['blog:1'],
    };
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        proposals: [proposal],
        enforcementGaps: [],
        injectionNotices: [],
      }),
      modelUsed: 'codex',
    });
    const result = await usecase.execute();
    expect(canonCheck.check).not.toHaveBeenCalled();
    expect(result.output.proposals[0]).toMatchObject({ baseSha: null });
    expect(result.included[0].id).toBe('blog:1');
  });
});
