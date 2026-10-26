import { AgentRunService } from '../../../../agent-run/application/agent-run.service';
import { CollectionStatus } from '../../domain/humanize-research.type';
import { HumanizerSignalsCollector } from './humanizer-signals.collector';

const processed = {
  humanizerMaxRunId: '10',
  blogPostIds: [],
  upstreamHead: null,
  arxivIds: [],
};

describe('HumanizerSignalsCollector', () => {
  it('직전 처리 id 이후의 원장 지표만 집계한다', async () => {
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([
      { id: 9, output: { rolledBackKeys: ['old'] } },
      {
        id: 11,
        output: {
          rolledBackKeys: ['body'],
          overRewrittenKeys: ['title'],
          translationese: { doublePassiveCount: 2 },
          preservationViolations: { lost: { code: 1 } },
          styleGaps: ['문단 1(≥2)'],
        },
      },
    ]);
    const collector = new HumanizerSignalsCollector({
      findRecentSucceededRuns,
    } as unknown as AgentRunService);

    const result = await collector.collect(processed);

    expect(result.status).toBe(CollectionStatus.OK);
    expect(result.items[0].id).toBe('humanizer:11-11');
    expect(result.items[0].text).toContain('body: 1');
    expect(result.items[0].text).not.toContain('old');
  });

  it('번역투 개수 축은 합계, 비율 축은 평균으로 낸다', async () => {
    const run = (id: number, percent: number) => ({
      id,
      output: {
        translationese: {
          doublePassiveCount: 2,
          inanimateSubjectPercent: percent,
        },
      },
    });
    const collector = new HumanizerSignalsCollector({
      findRecentSucceededRuns: jest
        .fn()
        .mockResolvedValue([run(11, 20), run(12, 40)]),
    } as unknown as AgentRunService);

    const result = await collector.collect(processed);

    expect(result.items[0].text).toContain('doublePassiveCount: 4');
    expect(result.items[0].text).toContain('inanimateSubjectPercent(평균): 30');
  });

  it('조회 실패를 FAILED 결과로 돌린다', async () => {
    const collector = new HumanizerSignalsCollector({
      findRecentSucceededRuns: jest
        .fn()
        .mockRejectedValue(new Error('ledger down')),
    } as unknown as AgentRunService);

    const result = await collector.collect(processed);

    expect(result.status).toBe(CollectionStatus.FAILED);
    expect(result.error).toBe('ledger down');
  });
});
