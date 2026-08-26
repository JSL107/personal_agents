import { AUTOPILOT_PLAYBOOK, validatePlaybook } from './autopilot.playbook';
import { PlaybookEntry } from './playbook.type';

describe('AUTOPILOT_PLAYBOOK', () => {
  it('SP1 플레이북은 daily-eval CRON 항목을 포함한다', () => {
    const dailyEval = AUTOPILOT_PLAYBOOK.find((e) => e.id === 'daily-eval');
    expect(dailyEval).toBeDefined();
    expect(dailyEval?.trigger.kind).toBe('CRON');
    expect(dailyEval?.taskId).toBe('daily-eval');
    expect(dailyEval?.riskTier).toBe('T0_AUTO');
  });

  it('validatePlaybook 은 정상 플레이북을 통과시킨다', () => {
    expect(() => validatePlaybook(AUTOPILOT_PLAYBOOK)).not.toThrow();
  });

  it('SP2 플레이북은 morning-briefing 항목을 포함한다', () => {
    const morning = AUTOPILOT_PLAYBOOK.find(
      (entry) => entry.id === 'morning-briefing',
    );
    expect(morning?.taskId).toBe('morning-briefing');
    expect(morning?.digestGroup).toBe('morning');
  });

  it('noon 그룹은 매일 13:00 KST에 assign, po-shadow 순서로 실행한다', () => {
    const noonEntries = AUTOPILOT_PLAYBOOK.filter(
      (entry) => entry.digestGroup === 'noon',
    );

    expect(noonEntries.map((entry) => entry.id)).toEqual([
      'assign',
      'po-shadow',
    ]);
    expect(noonEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          riskTier: 'T0_AUTO',
          trigger: {
            kind: 'CRON',
            schedule: '0 13 * * *',
            timezone: 'Asia/Seoul',
          },
        }),
      ]),
    );
  });

  it('저녁 그룹은 기존 선두를 유지하고 블로그 GitHub 발행을 맨 뒤에서 실행한다', () => {
    const eveningEntries = AUTOPILOT_PLAYBOOK.filter(
      (entry) => entry.digestGroup === 'evening',
    );
    expect(eveningEntries.map((entry) => entry.id)).toEqual([
      'work-reviewer',
      'daily-eval',
      'evening-retro-publish',
      'blog-github-publish',
    ]);
    expect(eveningEntries.at(-1)).toMatchObject({
      taskId: 'blog-github-publish',
      riskTier: 'T1_PREVIEW',
      trigger: {
        kind: 'CRON',
        schedule: '0 19 * * *',
        timezone: 'Asia/Seoul',
      },
    });
  });

  it('SP3 플레이북 evening 그룹은 validatePlaybook 통과(스케줄 일치)', () => {
    expect(() => validatePlaybook(AUTOPILOT_PLAYBOOK)).not.toThrow();
  });

  it('docs-sync-audit 항목을 포함한다 (주간 CRON, T1_PREVIEW)', () => {
    const docsAudit = AUTOPILOT_PLAYBOOK.find(
      (entry) => entry.id === 'docs-sync-audit',
    );
    expect(docsAudit?.taskId).toBe('docs-sync-audit');
    expect(docsAudit?.trigger.kind).toBe('CRON');
    expect(docsAudit?.riskTier).toBe('T1_PREVIEW');
    expect(docsAudit?.digestGroup).toBeUndefined();
  });

  it('run-sweeper와 ops-supervisor 독립 CRON 항목을 포함한다', () => {
    const runSweeper = AUTOPILOT_PLAYBOOK.find(
      (entry) => entry.id === 'run-sweeper',
    );
    const opsSupervisor = AUTOPILOT_PLAYBOOK.find(
      (entry) => entry.id === 'ops-supervisor',
    );

    expect(runSweeper).toMatchObject({
      taskId: 'run-sweeper',
      riskTier: 'T0_AUTO',
      trigger: { kind: 'CRON', schedule: '50 * * * *' },
    });
    expect(opsSupervisor).toMatchObject({
      taskId: 'ops-supervisor',
      riskTier: 'T0_AUTO',
      trigger: { kind: 'CRON', schedule: '0 9 1 * *' },
    });
  });

  it('주식 알림 사후 채점을 평일 18시 독립 T0 task로 포함한다', () => {
    const scoring = AUTOPILOT_PLAYBOOK.find(
      (entry) => entry.id === 'stock-alert-scoring',
    );

    expect(scoring).toMatchObject({
      taskId: 'stock-alert-scoring',
      riskTier: 'T0_AUTO',
      trigger: {
        kind: 'CRON',
        schedule: '0 18 * * 1-5',
        timezone: 'Asia/Seoul',
      },
    });
    expect(scoring?.digestGroup).toBeUndefined();
  });

  it('미국 주식 모니터링을 ET 마감 30분 후 독립 항목으로 포함한다', () => {
    const stockMonitorUs = AUTOPILOT_PLAYBOOK.find(
      (entry) => entry.id === 'stock-monitor-us',
    );

    expect(stockMonitorUs).toMatchObject({
      taskId: 'stock-monitor-us',
      riskTier: 'T0_AUTO',
      trigger: {
        kind: 'CRON',
        schedule: '30 16 * * 1-5',
        timezone: 'America/New_York',
      },
    });
    expect(stockMonitorUs?.digestGroup).toBeUndefined();
  });

  it('모의투자 평가를 평일 17:40 KST standalone 항목으로 포함한다', () => {
    const paperTrading = AUTOPILOT_PLAYBOOK.find(
      (entry) => entry.id === 'paper-trading',
    );

    expect(paperTrading).toMatchObject({
      taskId: 'paper-trading',
      riskTier: 'T0_AUTO',
      trigger: {
        kind: 'CRON',
        schedule: '40 17 * * 1-5',
        timezone: 'Asia/Seoul',
      },
    });
    expect(paperTrading?.digestGroup).toBeUndefined();
  });

  it('유니버스 수집을 모의투자 바로 뒤 18:30 KST standalone 항목으로 포함한다', () => {
    const paperTradingIndex = AUTOPILOT_PLAYBOOK.findIndex(
      (entry) => entry.id === 'paper-trading',
    );
    const universeSweep = AUTOPILOT_PLAYBOOK[paperTradingIndex + 1];

    expect(universeSweep).toMatchObject({
      id: 'universe-sweep',
      taskId: 'universe-sweep',
      riskTier: 'T0_AUTO',
      trigger: {
        kind: 'CRON',
        schedule: '30 18 * * *',
        timezone: 'Asia/Seoul',
      },
    });
    expect(universeSweep.digestGroup).toBeUndefined();
  });

  it('모의투자 추천을 유니버스 수집 바로 뒤 평일 19:30 KST standalone 항목으로 포함한다', () => {
    const universeSweepIndex = AUTOPILOT_PLAYBOOK.findIndex(
      (entry) => entry.id === 'universe-sweep',
    );
    const paperRecommend = AUTOPILOT_PLAYBOOK[universeSweepIndex + 1];

    expect(paperRecommend).toMatchObject({
      id: 'paper-recommend',
      taskId: 'paper-recommend',
      riskTier: 'T0_AUTO',
      trigger: {
        kind: 'CRON',
        schedule: '30 19 * * 1-5',
        timezone: 'Asia/Seoul',
      },
    });
    expect(paperRecommend.digestGroup).toBeUndefined();
  });

  it('모의투자 체결을 평일 10분 주기 standalone 항목으로 포함한다', () => {
    const paperOrderFill = AUTOPILOT_PLAYBOOK.find(
      (entry) => entry.id === 'paper-order-fill',
    );

    expect(paperOrderFill).toMatchObject({
      taskId: 'paper-order-fill',
      riskTier: 'T0_AUTO',
      trigger: {
        kind: 'CRON',
        schedule: '*/10 9-15 * * 1-5',
        timezone: 'Asia/Seoul',
      },
    });
    expect(paperOrderFill?.digestGroup).toBeUndefined();
  });

  it('모의투자 장중 손절을 체결 바로 뒤 평일 5분 주기 standalone 항목으로 포함한다', () => {
    const paperOrderFillIndex = AUTOPILOT_PLAYBOOK.findIndex(
      (entry) => entry.id === 'paper-order-fill',
    );
    const paperIntradayStop = AUTOPILOT_PLAYBOOK[paperOrderFillIndex + 1];

    expect(paperIntradayStop).toMatchObject({
      id: 'paper-intraday-stop',
      taskId: 'paper-intraday-stop',
      riskTier: 'T0_AUTO',
      trigger: {
        kind: 'CRON',
        schedule: '2-57/5 9-15 * * 1-5',
        timezone: 'Asia/Seoul',
      },
    });
    expect(paperIntradayStop.digestGroup).toBeUndefined();
  });

  it('모의투자 추천 성적을 장중 손절 바로 뒤 금요일 20:10 KST standalone 항목으로 포함한다', () => {
    const paperIntradayStopIndex = AUTOPILOT_PLAYBOOK.findIndex(
      (entry) => entry.id === 'paper-intraday-stop',
    );
    const paperScore = AUTOPILOT_PLAYBOOK[paperIntradayStopIndex + 1];

    expect(paperScore).toMatchObject({
      id: 'paper-score',
      taskId: 'paper-score',
      riskTier: 'T0_AUTO',
      trigger: {
        kind: 'CRON',
        schedule: '10 20 * * 5',
        timezone: 'Asia/Seoul',
      },
    });
    expect(paperScore.digestGroup).toBeUndefined();
  });

  // 배열에서 뒤에 오는 것과 실제로 늦게 도는 것은 다르다. 채점을 수집보다 앞에 두면 그날 종가가
  // 없어 성적표에서 그 몫이 결손 처리되는데, 배열 인접성만 보는 단언은 그 상태를 통과시킨다.
  // 실제로 채점 18:10 < 수집 18:30 인 채로 리뷰까지 갔다.
  it('당일 시세를 읽는 작업은 유니버스 수집보다 늦게 실행된다', () => {
    const startMinuteOfDay = (schedule: string): number => {
      const [minute, hour] = schedule.split(' ');
      return Number(hour) * 60 + Number(minute);
    };
    const scheduleOf = (id: string): string => {
      const entry = AUTOPILOT_PLAYBOOK.find((candidate) => candidate.id === id);
      if (!entry || entry.trigger.kind !== 'CRON') {
        throw new Error(`CRON 항목이 아니다: ${id}`);
      }
      return entry.trigger.schedule;
    };

    const sweepStartMinute = startMinuteOfDay(scheduleOf('universe-sweep'));
    for (const dependentId of ['paper-recommend', 'paper-score']) {
      expect(startMinuteOfDay(scheduleOf(dependentId))).toBeGreaterThan(
        sweepStartMinute,
      );
    }
  });

  it('validatePlaybook 은 중복 id 를 거부한다', () => {
    const dup: PlaybookEntry[] = [
      {
        id: 'x',
        taskId: 'x',
        trigger: {
          kind: 'CRON',
          schedule: '0 9 * * *',
          timezone: 'Asia/Seoul',
        },
        riskTier: 'T0_AUTO',
      },
      {
        id: 'x',
        taskId: 'x',
        trigger: {
          kind: 'CRON',
          schedule: '0 9 * * *',
          timezone: 'Asia/Seoul',
        },
        riskTier: 'T0_AUTO',
      },
    ];
    expect(() => validatePlaybook(dup)).toThrow(/중복/);
  });

  it('같은 digestGroup 인데 schedule 이 다른 항목 → validatePlaybook throw', () => {
    const mismatch: PlaybookEntry[] = [
      {
        id: 'a',
        taskId: 'a',
        trigger: {
          kind: 'CRON',
          schedule: '0 19 * * *',
          timezone: 'Asia/Seoul',
        },
        riskTier: 'T0_AUTO',
        digestGroup: 'evening',
      },
      {
        id: 'b',
        taskId: 'b',
        trigger: {
          kind: 'CRON',
          schedule: '0 20 * * *',
          timezone: 'Asia/Seoul',
        },
        riskTier: 'T0_AUTO',
        digestGroup: 'evening',
      },
    ];
    expect(() => validatePlaybook(mismatch)).toThrow(/그룹.*스케줄|schedule/);
  });

  it('같은 digestGroup 인데 timezone 이 다른 항목 → validatePlaybook throw', () => {
    const mismatch: PlaybookEntry[] = [
      {
        id: 'c',
        taskId: 'c',
        trigger: {
          kind: 'CRON',
          schedule: '0 19 * * *',
          timezone: 'Asia/Seoul',
        },
        riskTier: 'T0_AUTO',
        digestGroup: 'evening',
      },
      {
        id: 'd',
        taskId: 'd',
        trigger: { kind: 'CRON', schedule: '0 19 * * *', timezone: 'UTC' },
        riskTier: 'T0_AUTO',
        digestGroup: 'evening',
      },
    ];
    expect(() => validatePlaybook(mismatch)).toThrow(/그룹.*스케줄|schedule/);
  });
});
