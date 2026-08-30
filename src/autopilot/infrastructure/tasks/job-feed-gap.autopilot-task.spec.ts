import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { JobFeedGapAutopilotTask } from './job-feed-gap.autopilot-task';

// app.config.ts 가 JOB_FEED_MATCH_THRESHOLD·JOB_FEED_GAP_ANALYSIS_TOP_N 을
// @Type(() => Number) 로 선언한 뒤로 ConfigService.get() 은 실제로 number 를 돌려준다.
function makeConfig(values: Record<string, string | number | undefined> = {}) {
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
        JOB_FEED_GAP_ANALYSIS_TOP_N: 0,
      }) as never,
    );

    const result = await task.run(CONTEXT);

    expect(result).toEqual({ skip: true });
    expect(repository.findGapCandidates).not.toHaveBeenCalled();
  });

  it('JOB_FEED_GAP_ANALYSIS_TOP_N 미설정이면 코드 기본값 1을 쓴다', async () => {
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

    await task.run(CONTEXT);

    // 미설정 시 threshold 도 코드 기본값(80)을 쓴다.
    expect(repository.findGapCandidates).toHaveBeenCalledWith(80, 1, []);
  });

  it('JOB_FEED_AVOID_SKILLS 를 정규화해 findGapCandidates 에 넘긴다 — 기피 회사 공고가 갭 분석(모델 호출)에 쓰이면 안 된다', async () => {
    const repository = {
      findGapCandidates: jest.fn().mockResolvedValue([]),
      saveGapAgentRunId: jest.fn(),
    };
    const analyzeJdGap = { execute: jest.fn() };
    const task = new JobFeedGapAutopilotTask(
      analyzeJdGap as never,
      repository as never,
      makeConfig({
        JOB_FEED_ENABLED: 'true',
        // 소문자·쉼표 구분 입력이 저장된 정규명(PHP·JSP)으로 정규화돼야 한다.
        JOB_FEED_AVOID_SKILLS: 'php, jsp,',
      }) as never,
    );

    await task.run(CONTEXT);

    expect(repository.findGapCandidates).toHaveBeenCalledWith(80, 1, [
      'PHP',
      'JSP',
    ]);
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
        JOB_FEED_MATCH_THRESHOLD: 70,
        JOB_FEED_GAP_ANALYSIS_TOP_N: 2,
      }) as never,
    );

    const result = await task.run(CONTEXT);

    expect(repository.findGapCandidates).toHaveBeenCalledWith(70, 2, []);
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

  it('후보 처리가 실패해도 예외를 던지지 않고 실패 사유를 카드에 남긴다', async () => {
    const found = candidate({ company: '토스' });
    const repository = {
      findGapCandidates: jest.fn().mockResolvedValue([found]),
      saveGapAgentRunId: jest.fn().mockResolvedValue(undefined),
    };
    const analyzeJdGap = {
      execute: jest.fn().mockRejectedValue(new Error('쿼터 소진')),
    };
    const task = new JobFeedGapAutopilotTask(
      analyzeJdGap as never,
      repository as never,
      makeConfig({ JOB_FEED_ENABLED: 'true' }) as never,
    );

    const result = await task.run(CONTEXT);

    expect(repository.saveGapAgentRunId).not.toHaveBeenCalled();
    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('토스');
    expect(result.summaryText).toContain('갭 분석 실패');
    expect(result.summaryText).toContain('쿼터 소진');
  });

  // 예산 안전장치 — 순차 모델 호출 1건의 worst-case(MODEL_ROUTER_WORST_CASE_MS=606초)가
  // 이미 안전 상한(AUTOPILOT_WORKER_OPTIONS.lockDuration 의 60%=525.6초)보다 크기 때문에,
  // 이 가드는 실행 속도와 무관하게 "같은 회차엔 최대 1건만 처리"로 항상 귀결된다 — Date.now()
  // 를 흉내 낼 필요 없이 결정론적으로 재현된다(job-feed-gap.autopilot-task.ts 상단 주석 참조).
  it('예산 안전장치 — 후보가 2건이어도 1건만 처리하고 나머지는 다음 회차로 미룬다', async () => {
    const first = candidate({ id: 1, company: '토스' });
    const second = candidate({ id: 2, company: '카카오' });
    const repository = {
      findGapCandidates: jest.fn().mockResolvedValue([first, second]),
      saveGapAgentRunId: jest.fn().mockResolvedValue(undefined),
    };
    const analyzeJdGap = {
      execute: jest.fn().mockResolvedValue({
        result: { fitSummary: '적합', have: [], gaps: [], topics: [] },
        modelUsed: 'gpt-test',
        agentRunId: 99,
      }),
    };
    const task = new JobFeedGapAutopilotTask(
      analyzeJdGap as never,
      repository as never,
      makeConfig({
        JOB_FEED_ENABLED: 'true',
        JOB_FEED_GAP_ANALYSIS_TOP_N: 2,
      }) as never,
    );

    const result = await task.run(CONTEXT);

    // 두 후보 모두 성공했을 실패가 아니라 "예산" 때문에 멈춘 것임을 확인 —
    // 두 번째 후보는 시도조차 되지 않는다.
    expect(analyzeJdGap.execute).toHaveBeenCalledTimes(1);
    expect(repository.saveGapAgentRunId).toHaveBeenCalledTimes(1);
    expect(repository.saveGapAgentRunId).toHaveBeenCalledWith(1, 99);
    expect(result.summaryText).toContain('토스');
    expect(result.summaryText).not.toContain('카카오');
    expect(result.summaryText).toContain('⏱️');
    expect(result.summaryText).toContain('남은 1건');
  });
});
