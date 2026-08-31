import { AUTOPILOT_PLAYBOOK } from '../domain/autopilot.playbook';
import { AutopilotScheduler, isLowFrequencyCron } from './autopilot.scheduler';

const makeQueue = () => ({
  add: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
});

describe('AutopilotScheduler', () => {
  it.each([
    ['0 17 * * 5', true],
    ['10 20 * * 5', true],
    ['0 18 * * 0', true],
    ['0 9 * * 6', true],
    ['0 9 * * 1', true],
    ['0 10 * * 0', true],
    ['0 11 * * 0', true],
    ['0 12 * * 0', true],
    ['0 9 1 * *', true],
    ['30 8 * * *', false],
    ['0 19 * * *', false],
    ['0 13 * * *', false],
    ['10 17 * * 1-5', false],
    ['0 18 * * 1-5', false],
    ['30 16 * * 1-5', false],
    ['*/3 * * * *', false],
    ['*/10 * * * *', false],
    ['50 * * * *', false],
    ['0 0 17 * * 5', true],
    ['0 */3 * * * *', false],
    ['0 17 * *', false],
  ])('cron "%s"의 저빈도 판별값은 %s이다', (pattern, expected) => {
    expect(isLowFrequencyCron(pattern)).toBe(expected);
  });

  it('owner 미설정 → 등록 0 + cleanup 호출', async () => {
    const queue = makeQueue();
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();
    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.getRepeatableJobs).toHaveBeenCalled();
  });

  it('owner 설정 → 그룹당 1 repeatable 등록(jobName=groupKey)', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    // 각 그룹당 1번씩 queue.add 호출 — entry 수가 아닌 그룹 수.
    const addCalls: string[] = queue.add.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    // 동일 groupKey 로 중복 등록 없음 (그룹당 exactly 1).
    const unique = new Set(addCalls);
    expect(unique.size).toBe(addCalls.length);
    // SP4: evening(daily-eval+work-reviewer) + morning + noon(assign+po-shadow)
    //   + weekly-summary + ceo-meta + impact-report
    //   + run-retro(주간 실행 회고, 단독 그룹) + knowledge-lint(주간 무결성 점검, 단독 그룹)
    //   + docs-sync-audit + preference-learning + run-sweeper + preview-sweeper + ops-supervisor
    //   + stock-monitor + paper-trading + universe-sweep + stock-monitor-us + stock-alert-scoring + pr-review-sweep
    //   + paper-score + ai-cli-env-snapshot + ai-cli-env-apply
    //   + portfolio-warmup(사이트 워밍업) + portfolio-publish(사이트 발행)
    //   + screening-outcome-scoring(회차 종목 사후 채점, 단독 그룹)
    //   + paper-intraday-stop(모의투자 장중 손절, 단독 그룹)
    //   + job-feed(백엔드 채용공고 수집, 단독 그룹) + job-feed-gap(공고 갭 분석, 단독 그룹)
    //   + screening-scorecard(주간 성적 카드, 단독 그룹) = 32그룹.
    expect(queue.add).toHaveBeenCalledTimes(32);
    expect(addCalls).toContain('screening-outcome-scoring');
    expect(addCalls).toContain('screening-scorecard');
    expect(addCalls).toContain('evening');
    expect(addCalls).toContain('portfolio-warmup');
    expect(addCalls).toContain('portfolio-publish');
    expect(addCalls).toContain('study-deepdive');
    expect(addCalls).toContain('morning');
    expect(addCalls).toContain('noon');
    expect(addCalls).toContain('weekly-summary');
    expect(addCalls).toContain('ceo-meta');
    expect(addCalls).toContain('impact-report');
    expect(addCalls).toContain('run-retro');
    expect(addCalls).toContain('knowledge-lint');
    expect(addCalls).toContain('docs-sync-audit');
    expect(addCalls).toContain('preference-learning');
    expect(addCalls).toContain('run-sweeper');
    expect(addCalls).toContain('preview-sweeper');
    expect(addCalls).toContain('ops-supervisor');
    expect(addCalls).toContain('stock-monitor');
    expect(addCalls).toContain('paper-trading');
    expect(addCalls).toContain('paper-score');
    expect(addCalls).toContain('universe-sweep');
    expect(addCalls).toContain('stock-monitor-us');
    expect(addCalls).toContain('stock-alert-scoring');
    expect(addCalls).toContain('pr-review-sweep');
    expect(addCalls).toContain('ai-cli-env-snapshot');
    expect(addCalls).toContain('ai-cli-env-apply');
    expect(addCalls).toContain('job-feed');
    expect(addCalls).toContain('job-feed-gap');
  });

  it('evening 그룹 스케줄은 첫 항목(work-reviewer) env 기반 → 19:00', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    const eveningCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'evening',
    );
    expect(eveningCall).toBeDefined();
    expect(eveningCall[2]).toMatchObject({
      repeat: { pattern: '0 19 * * *', tz: 'Asia/Seoul' },
    });
  });

  it('morning 그룹 등록 확인 — jobName="morning", schedule=08:30', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    const morningCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'morning',
    );
    expect(morningCall).toBeDefined();
    expect(morningCall[2]).toMatchObject({
      repeat: { pattern: '30 8 * * *', tz: 'Asia/Seoul' },
    });
  });

  it('주간 그룹은 시간 단위 재시도 옵션으로 등록한다', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    const weeklySummaryCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'weekly-summary',
    );
    expect(weeklySummaryCall).toBeDefined();
    expect(weeklySummaryCall[2]).toMatchObject({
      attempts: 4,
      backoff: { type: 'exponential', delay: 1_800_000 },
    });
  });

  it('금요일 모의투자 채점도 저빈도 재시도 옵션으로 등록한다', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    const paperScoreCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'paper-score',
    );
    expect(paperScoreCall?.[2]).toMatchObject({
      repeat: { pattern: '10 20 * * 5', tz: 'Asia/Seoul' },
      attempts: 4,
      backoff: { type: 'exponential', delay: 1_800_000 },
    });
  });

  it('일간 그룹은 기존 재시도 옵션으로 등록한다', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    const morningCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'morning',
    );
    expect(morningCall).toBeDefined();
    expect(morningCall[2]).toMatchObject({
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });
  });

  it('첫 항목 schedule override의 resolved cron으로 repeat와 재시도 정책을 등록한다', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AUTOPILOT_OWNER_SLACK_USER_ID') {
          return 'U1';
        }
        if (key === 'AUTOPILOT_WEEKLY_SUMMARY_SCHEDULE') {
          return '0 17 * * *';
        }
        return undefined;
      }),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    const weeklySummaryCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'weekly-summary',
    );
    expect(weeklySummaryCall).toBeDefined();
    expect(weeklySummaryCall[2]).toMatchObject({
      repeat: { pattern: '0 17 * * *', tz: 'Asia/Seoul' },
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });
  });

  it('AI CLI 환경 태스크는 계약 전용 cron/timezone 키를 우선 적용한다', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AUTOPILOT_OWNER_SLACK_USER_ID') {
          return 'U1';
        }
        if (key === 'AI_CLI_ENV_SNAPSHOT_CRON') {
          return '15 18 * * 5';
        }
        if (key === 'AI_CLI_ENV_SNAPSHOT_TIMEZONE') {
          return 'America/New_York';
        }
        if (key === 'AI_CLI_ENV_APPLY_CRON') {
          return '30 11 * * *';
        }
        if (key === 'AI_CLI_ENV_APPLY_TIMEZONE') {
          return 'Europe/London';
        }
        return undefined;
      }),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);

    await scheduler.onApplicationBootstrap();

    const snapshotCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'ai-cli-env-snapshot',
    );
    const applyCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'ai-cli-env-apply',
    );
    expect(snapshotCall?.[2]).toMatchObject({
      repeat: { pattern: '15 18 * * 5', tz: 'America/New_York' },
    });
    expect(applyCall?.[2]).toMatchObject({
      repeat: { pattern: '30 11 * * *', tz: 'Europe/London' },
    });
  });

  it('AUTOPILOT_INVEST_TARGET → 투자 라인만 채널로, 나머지는 공통 TARGET 유지', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AUTOPILOT_OWNER_SLACK_USER_ID') {
          return 'U1';
        }
        if (key === 'AUTOPILOT_TARGET') {
          return 'U1';
        }
        if (key === 'AUTOPILOT_INVEST_TARGET') {
          return 'C0STOCK';
        }
        return undefined;
      }),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);

    await scheduler.onApplicationBootstrap();

    const stockCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'stock-monitor',
    );
    const morningCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'morning',
    );
    expect(stockCall?.[1]).toMatchObject({
      ownerSlackUserId: 'U1',
      target: 'C0STOCK',
    });
    // override 가 없는 그룹까지 끌려가면 안 된다 — 이 단언이 없으면 전역 치환도 통과한다.
    expect(morningCall?.[1]).toMatchObject({
      ownerSlackUserId: 'U1',
      target: 'U1',
    });

    // 투자 라인은 전수로 확인한다. 대표 한둘만 보면 태그 누락이 조용히 통과한다.
    const investGroups = AUTOPILOT_PLAYBOOK.filter(
      (entry) => entry.line === 'invest',
    ).map((entry) => entry.digestGroup ?? entry.id);
    expect(investGroups).toHaveLength(11);
    for (const groupKey of investGroups) {
      const call = queue.add.mock.calls.find(
        (item: unknown[]) => item[0] === groupKey,
      );
      expect(call?.[1]).toMatchObject({ target: 'C0STOCK' });
    }
  });

  it('AUTOPILOT_CAREER_TARGET → 커리어 라인만 채널로, 투자·공통은 각자 유지', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AUTOPILOT_OWNER_SLACK_USER_ID') {
          return 'U1';
        }
        if (key === 'AUTOPILOT_TARGET') {
          return 'U1';
        }
        if (key === 'AUTOPILOT_INVEST_TARGET') {
          return 'C0STOCK';
        }
        if (key === 'AUTOPILOT_CAREER_TARGET') {
          return 'C0JOB';
        }
        return undefined;
      }),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);

    await scheduler.onApplicationBootstrap();

    // 라인이 둘 이상일 때 서로 섞이지 않는지가 이 단언의 요지다 — 키를 하나만 두고
    // 보면 "override 가 먹는다"까지만 확인되고, 다른 라인이 끌려가는 것은 못 잡는다.
    const careerGroups = AUTOPILOT_PLAYBOOK.filter(
      (entry) => entry.line === 'career',
    ).map((entry) => entry.digestGroup ?? entry.id);
    expect(careerGroups).toHaveLength(2);
    for (const groupKey of careerGroups) {
      const call = queue.add.mock.calls.find(
        (item: unknown[]) => item[0] === groupKey,
      );
      expect(call?.[1]).toMatchObject({ target: 'C0JOB' });
    }

    const stockCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'stock-monitor',
    );
    const morningCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'morning',
    );
    expect(stockCall?.[1]).toMatchObject({ target: 'C0STOCK' });
    expect(morningCall?.[1]).toMatchObject({ target: 'U1' });
  });

  it('AUTOPILOT_CAREER_TARGET 미설정이면 커리어 라인도 공통 TARGET 을 쓴다', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AUTOPILOT_OWNER_SLACK_USER_ID') {
          return 'U1';
        }
        if (key === 'AUTOPILOT_TARGET') {
          return 'C0COMMON';
        }
        return undefined;
      }),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);

    await scheduler.onApplicationBootstrap();

    const jobFeedCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'job-feed',
    );
    expect(jobFeedCall?.[1]).toMatchObject({ target: 'C0COMMON' });
  });

  it('AUTOPILOT_INVEST_TARGET 미설정이면 투자 라인도 공통 TARGET 을 쓴다', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AUTOPILOT_OWNER_SLACK_USER_ID') {
          return 'U1';
        }
        if (key === 'AUTOPILOT_TARGET') {
          return 'C0COMMON';
        }
        return undefined;
      }),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);

    await scheduler.onApplicationBootstrap();

    const stockCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'stock-monitor',
    );
    expect(stockCall?.[1]).toMatchObject({ target: 'C0COMMON' });
  });
});
