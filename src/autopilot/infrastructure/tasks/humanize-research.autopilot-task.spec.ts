import { ConfigService } from '@nestjs/config';

import { RunHumanizeResearchUsecase } from '../../../agent/humanize-research/application/run-humanize-research.usecase';
import { HumanizeResearchAutopilotTask } from './humanize-research.autopilot-task';

describe('HumanizeResearchAutopilotTask', () => {
  it('ENABLED가 false면 수집·모델 경로를 호출하지 않는다', async () => {
    const config = { get: jest.fn().mockReturnValue('false') };
    const research = { execute: jest.fn() };
    const task = new HumanizeResearchAutopilotTask(
      config as unknown as ConfigService,
      research as unknown as RunHumanizeResearchUsecase,
    );
    expect(await task.run()).toEqual({ skip: true });
    expect(research.execute).not.toHaveBeenCalled();
  });
});

it('PR 스위치가 켜지면 제안의 전문과 근거를 담은 카드를 만든다', async () => {
  const oldString =
    '  - 단일 피동 남발("검토된다", "예상된다", "~될 것으로 기대된다") → 능동으로. 행위자가 원문에 있으면 주어로 세우고, 없으면 주어를 생략한 능동으로 바꿔라("검토된다" → "검토한다"). 없는 행위자를 지어내지는 마라.';
  const config = { get: jest.fn().mockReturnValue('true') };
  const research = {
    execute: jest.fn().mockResolvedValue({
      output: {
        proposals: [
          {
            target: 'blog',
            file: 'src/humanize/domain/humanize-system.prompt.ts',
            oldString,
            newString: '새 문구',
            targetMetric: 'metric',
            rationale: 'reason',
            evidence: ['blog:1'],
            baseSha: null,
          },
        ],
        sources: [],
        skipped: [],
        enforcementGaps: [],
        injectionNotices: [],
        droppedForBudget: [],
        processed: {
          humanizerMaxRunId: null,
          blogPostIds: [],
          upstreamHead: null,
          canonHead: null,
          arxivIds: [],
        },
      },
      included: [{ id: 'blog:1', source: 'BLOG', text: '실제 근거' }],
    }),
  };
  const task = new HumanizeResearchAutopilotTask(
    config as unknown as ConfigService,
    research as unknown as RunHumanizeResearchUsecase,
  );
  const result = await task.run();
  expect(oldString.length).toBeGreaterThan(120);
  expect(result.previews).toHaveLength(1);
  expect(result.previews?.[0].previewText).toContain(oldString);
  expect(result.previews?.[0].previewText).toContain('실제 근거');
});

it('PR 스위치가 꺼지면 제안이 있어도 previews 를 만들지 않는다', async () => {
  const config = {
    get: jest.fn((key: string) =>
      key === 'HUMANIZE_RESEARCH_ENABLED' ? 'true' : 'false',
    ),
  };
  const research = {
    execute: jest.fn().mockResolvedValue({
      output: {
        proposals: [
          {
            target: 'canon',
            file: 'references/quick-rules.md',
            oldString:
              '| A-9 | "~에 의해" 피동 | S2 | 행위자를 주어로("AI에 의해 생성" → "AI가 만든") |',
            newString: '새 규칙',
            targetMetric: 'metric',
            rationale: 'reason',
            evidence: ['canon:1'],
            baseSha: 'abc',
          },
        ],
        sources: [],
        skipped: [],
        enforcementGaps: [],
        injectionNotices: [],
        droppedForBudget: [],
        processed: {
          humanizerMaxRunId: null,
          blogPostIds: [],
          upstreamHead: null,
          canonHead: null,
          arxivIds: [],
        },
      },
      included: [],
    }),
  };
  const task = new HumanizeResearchAutopilotTask(
    config as unknown as ConfigService,
    research as unknown as RunHumanizeResearchUsecase,
  );
  const result = await task.run();
  expect(result.previews).toBeUndefined();
});

it('정본 카드에 연결된 블로그 문구와 600자로 제한한 근거를 담는다', async () => {
  const oldString =
    '| A-9 | "~에 의해" 피동 | S2 | 행위자를 주어로("AI에 의해 생성" → "AI가 만든") |';
  const config = { get: jest.fn().mockReturnValue('true') };
  const research = {
    execute: jest.fn().mockResolvedValue({
      output: {
        proposals: [
          {
            target: 'canon',
            file: 'references/quick-rules.md',
            oldString,
            newString: '',
            targetMetric: 'metric',
            rationale: 'reason',
            evidence: ['canon:1'],
            baseSha: 'abc',
          },
        ],
        sources: [],
        skipped: [],
        enforcementGaps: [],
        injectionNotices: [],
        droppedForBudget: [],
        processed: {
          humanizerMaxRunId: null,
          blogPostIds: [],
          upstreamHead: null,
          canonHead: null,
          arxivIds: [],
        },
      },
      included: [
        { id: 'canon:1', source: 'CANON_LOG', text: '가'.repeat(700) },
      ],
    }),
  };
  const task = new HumanizeResearchAutopilotTask(
    config as unknown as ConfigService,
    research as unknown as RunHumanizeResearchUsecase,
  );
  const result = await task.run();
  const preview = result.previews?.[0];
  expect(preview?.previewText).toContain(
    '  - "~에 의해" 피동 → 행위자를 주어로("AI에 의해 생성된" → "AI가 만든")',
  );
  expect(preview?.previewText).toContain('(규칙 행 삭제)');
  expect(preview?.previewText).not.toContain('가'.repeat(601));
  const excerpt = `[canon:1] ${'가'.repeat(600)}`;
  expect(preview?.previewText).toContain(excerpt);
  expect(preview?.payload).toEqual(
    expect.objectContaining({ evidenceExcerpts: [excerpt] }),
  );
});
