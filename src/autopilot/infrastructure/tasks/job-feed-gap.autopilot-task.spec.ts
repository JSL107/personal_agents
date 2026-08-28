import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { JobFeedGapAutopilotTask } from './job-feed-gap.autopilot-task';

function makeConfig(values: Record<string, string | undefined> = {}) {
  return { get: jest.fn((key: string) => values[key]) };
}

const CONTEXT = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-27' };

const candidate = (override: Record<string, unknown> = {}) => {
  return {
    id: 1,
    source: 'jumpit',
    sourceId: '1',
    company: '토스',
    title: '백엔드 개발자',
    detailUrl: 'https://example.test/1',
    skillTags: ['Java'],
    rawSkillTags: [],
    minYears: 3,
    maxYears: 5,
    experienceLevel: 'mid',
    locations: ['서울'],
    normalizedKey: 'toss|백엔드개발자',
    jdText: '토스 백엔드 채용공고 본문',
    matchScore: 80,
    ...override,
  };
};

describe('JobFeedGapAutopilotTask', () => {
  it('JOB_FEED_ENABLED 미설정이면 skip=true 이고 조회조차 하지 않는다', async () => {
    const repository = {
      findGapCandidates: jest.fn(),
      saveGapAgentRunId: jest.fn(),
    };
    const analyzeJdGap = { execute: jest.fn() };
    const task = new JobFeedGapAutopilotTask(
      analyzeJdGap as never,
      repository as never,
      makeConfig() as never,
    );

    const result = await task.run(CONTEXT);

    expect(result).toEqual({ skip: true });
    expect(repository.findGapCandidates).not.toHaveBeenCalled();
  });

  it('JOB_FEED_GAP_ANALYSIS_TOP_N 이 0 이하면 skip=true 이다', async () => {
    const repository = {
      findGapCandidates: jest.fn(),
      saveGapAgentRunId: jest.fn(),
    };
    const analyzeJdGap = { execute: jest.fn() };
    const task = new JobFeedGapAutopilotTask(
      analyzeJdGap as never,
      repository as never,
      makeConfig({
        JOB_FEED_ENABLED: 'true',
        JOB_FEED_GAP_ANALYSIS_TOP_N: '0',
      }) as never,
    );

    const result = await task.run(CONTEXT);

    expect(result).toEqual({ skip: true });
    expect(repository.findGapCandidates).not.toHaveBeenCalled();
  });

  it('후보가 없으면 skip=true 이다', async () => {
    const repository = {
      findGapCandidates: jest.fn().mockResolvedValue([]),
      saveGapAgentRunId: jest.fn(),
    };
    const analyzeJdGap = { execute: jest.fn() };
    const task = new JobFeedGapAutopilotTask(
      analyzeJdGap as never,
      repository as never,
      makeConfig({ JOB_FEED_ENABLED: 'true' }) as never,
    );

    const result = await task.run(CONTEXT);

    expect(result).toEqual({ skip: true });
  });

  it('후보를 자동 경로(origin=JOB_FEED)로 분석하고 gapAgentRunId 를 저장한다', async () => {
    const found = candidate();
    const repository = {
      findGapCandidates: jest.fn().mockResolvedValue([found]),
      saveGapAgentRunId: jest.fn().mockResolvedValue(undefined),
    };
    const analyzeJdGap = {
      execute: jest.fn().mockResolvedValue({
        result: {
          fitSummary: '전반적으로 적합합니다.',
          have: ['Java'],
          gaps: ['Kubernetes', 'Kafka', 'gRPC', 'Redis'],
          topics: [],
        },
        modelUsed: 'gpt-test',
        agentRunId: 42,
      }),
    };
    const task = new JobFeedGapAutopilotTask(
      analyzeJdGap as never,
      repository as never,
      makeConfig({
        JOB_FEED_ENABLED: 'true',
        JOB_FEED_MATCH_THRESHOLD: '70',
        JOB_FEED_GAP_ANALYSIS_TOP_N: '3',
      }) as never,
    );

    const result = await task.run(CONTEXT);

    expect(repository.findGapCandidates).toHaveBeenCalledWith(70, 3);
    expect(analyzeJdGap.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      jdText: found.jdText,
      origin: 'JOB_FEED',
      company: found.company,
      role: found.title,
      triggerType: TriggerType.AUTOPILOT_JOB_FEED_GAP_CRON,
    });
    expect(repository.saveGapAgentRunId).toHaveBeenCalledWith(found.id, 42);
    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('토스');
    expect(result.summaryText).toContain('전반적으로 적합합니다.');
    // 3건만 보여준다 — 부족 기술이 4개여도 앞 3개만 노출.
    expect(result.summaryText).toContain('Kubernetes, Kafka, gRPC');
    expect(result.summaryText).not.toContain('Redis');
  });

  it('회사명·제목을 escape 한다 — 외부 원본 문자열이라 mrkdwn 제어문자가 섞일 수 있다', async () => {
    const found = candidate({ company: 'A&B <주식회사>', title: '*백엔드*' });
    const repository = {
      findGapCandidates: jest.fn().mockResolvedValue([found]),
      saveGapAgentRunId: jest.fn().mockResolvedValue(undefined),
    };
    const analyzeJdGap = {
      execute: jest.fn().mockResolvedValue({
        result: { fitSummary: 'ok', have: [], gaps: [], topics: [] },
        modelUsed: 'gpt-test',
        agentRunId: 1,
      }),
    };
    const task = new JobFeedGapAutopilotTask(
      analyzeJdGap as never,
      repository as never,
      makeConfig({ JOB_FEED_ENABLED: 'true' }) as never,
    );

    const result = await task.run(CONTEXT);

    expect(result.summaryText).toContain('&amp;');
    expect(result.summaryText).toContain('&lt;');
    expect(result.summaryText).not.toContain('<주식회사>');
  });

  it('jdText 가 null 이어도 빈 문자열로 넘긴다', async () => {
    const found = candidate({ jdText: null });
    const repository = {
      findGapCandidates: jest.fn().mockResolvedValue([found]),
      saveGapAgentRunId: jest.fn().mockResolvedValue(undefined),
    };
    const analyzeJdGap = {
      execute: jest.fn().mockResolvedValue({
        result: { fitSummary: 'ok', have: [], gaps: [], topics: [] },
        modelUsed: 'gpt-test',
        agentRunId: 1,
      }),
    };
    const task = new JobFeedGapAutopilotTask(
      analyzeJdGap as never,
      repository as never,
      makeConfig({ JOB_FEED_ENABLED: 'true' }) as never,
    );

    await task.run(CONTEXT);

    expect(analyzeJdGap.execute).toHaveBeenCalledWith(
      expect.objectContaining({ jdText: '' }),
    );
  });

  it('한 후보가 실패해도 나머지를 계속 처리하고 실패 사유를 카드에 남긴다', async () => {
    const first = candidate({ id: 1, company: '토스' });
    const second = candidate({ id: 2, company: '카카오' });
    const repository = {
      findGapCandidates: jest.fn().mockResolvedValue([first, second]),
      saveGapAgentRunId: jest.fn().mockResolvedValue(undefined),
    };
    const analyzeJdGap = {
      execute: jest
        .fn()
        .mockRejectedValueOnce(new Error('쿼터 소진'))
        .mockResolvedValueOnce({
          result: { fitSummary: '적합', have: [], gaps: [], topics: [] },
          modelUsed: 'gpt-test',
          agentRunId: 99,
        }),
    };
    const task = new JobFeedGapAutopilotTask(
      analyzeJdGap as never,
      repository as never,
      makeConfig({ JOB_FEED_ENABLED: 'true' }) as never,
    );

    const result = await task.run(CONTEXT);

    expect(analyzeJdGap.execute).toHaveBeenCalledTimes(2);
    expect(repository.saveGapAgentRunId).toHaveBeenCalledTimes(1);
    expect(repository.saveGapAgentRunId).toHaveBeenCalledWith(2, 99);
    expect(result.summaryText).toContain('토스');
    expect(result.summaryText).toContain('갭 분석 실패');
    expect(result.summaryText).toContain('쿼터 소진');
    expect(result.summaryText).toContain('카카오');
    expect(result.summaryText).toContain('적합');
  });
});
