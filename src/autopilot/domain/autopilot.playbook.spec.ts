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

  it('백엔드 채용공고 수집을 평일 07:00 KST standalone 항목으로 포함한다', () => {
    const jobFeed = AUTOPILOT_PLAYBOOK.find((entry) => entry.id === 'job-feed');

    expect(jobFeed).toMatchObject({
      taskId: 'job-feed',
      riskTier: 'T0_AUTO',
      trigger: {
        kind: 'CRON',
        schedule: '0 7 * * 1-5',
        timezone: 'Asia/Seoul',
      },
    });
    expect(jobFeed?.digestGroup).toBeUndefined();
  });

  // 모델을 부르는 갭 분석은 수집과 다른 슬롯이어야 그룹 잠금 시간 예산을 넘기지 않는다
  // (worker-options.constant.ts). digestGroup 을 공유하지 않는지도 함께 확인한다.
  it('공고 갭 분석을 수집 바로 뒤 평일 07:30 KST standalone 항목으로 포함한다', () => {
    const jobFeedIndex = AUTOPILOT_PLAYBOOK.findIndex(
      (entry) => entry.id === 'job-feed',
    );
    const jobFeedGap = AUTOPILOT_PLAYBOOK[jobFeedIndex + 1];

    expect(jobFeedGap).toMatchObject({
      id: 'job-feed-gap',
      taskId: 'job-feed-gap',
      riskTier: 'T0_AUTO',
      trigger: {
        kind: 'CRON',
        schedule: '30 7 * * 1-5',
        timezone: 'Asia/Seoul',
      },
    });
    expect(jobFeedGap.digestGroup).toBeUndefined();
  });
});

// 대부분의 task 클래스는 `<PascalCase(taskId)>AutopilotTask` 관례를 따르지만, 이 관례가
// 확립되기 전에 붙은 이름 셋과 클래스 하나를 taskId 둘이 나눠 쓰는 경우 하나가 예외다.
// 정합성 테스트가 이 넷에서 오탐으로 깨지지 않도록 실제 클래스명을 명시한다 — 새 task 를
// 추가하면서 관례를 벗어나고 싶다면, 여기 슬쩍 끼워 넣지 말고 이유를 주석으로 남길 것.
const TASK_ID_CLASS_NAME_OVERRIDE: Readonly<Record<string, string>> = {
  // src/daily-eval 에서 이관되며 PoEvalAutopilotTask 가 taskId 'daily-eval' 을 그대로 받았다.
  'daily-eval': 'PoEvalAutopilotTask',
  // 관례 확립 이전에 붙은 클래스명 — 접미사가 Task 뿐이고 AutopilotTask 가 아니다.
  'evening-retro-publish': 'EveningRetroPublishTask',
  'docs-sync-audit': 'DocsSyncAuditTask',
  // 국가만 다른 동일 로직이라 StockMonitorAutopilotTask 하나를 파라미터로 재사용한다
  // (STOCK_MONITOR_KR_TASK / STOCK_MONITOR_US_TASK 팩토리 참조).
  'stock-monitor-us': 'StockMonitorAutopilotTask',
};

// AUTOPILOT_TASKS 프로바이더 텍스트에서 useFactory 파라미터 목록과 그 뒤에 오는 반환
// 배열(`) => [ ... ]`)을 각각 잘라낸다. 실제 인스턴스를 만들지 않고 문자열만 다루므로
// Nest 모듈을 부팅하지 않는다 — 부팅하면 실행 중인 정기 실행 등록을 건드린다
// (Nest 전체 부팅의 부작용, feedback_nest_full_boot_side_effect).
const extractAutopilotTasksFactoryBlocks = (
  moduleSource: string,
): { paramsBlock: string; returnBlock: string } => {
  const providerStart = moduleSource.indexOf('provide: AUTOPILOT_TASKS');
  if (providerStart === -1) {
    throw new Error('AUTOPILOT_TASKS 프로바이더를 모듈 소스에서 찾지 못했다');
  }
  const useFactoryStart = moduleSource.indexOf('useFactory: (', providerStart);
  const arrowStart = moduleSource.indexOf(') => [', useFactoryStart);
  const injectStart = moduleSource.indexOf('inject: [', arrowStart);
  const returnArrayEnd = moduleSource.lastIndexOf('],', injectStart);

  return {
    paramsBlock: moduleSource.slice(
      useFactoryStart + 'useFactory: ('.length,
      arrowStart,
    ),
    returnBlock: moduleSource.slice(
      arrowStart + ') => ['.length,
      returnArrayEnd,
    ),
  };
};

describe('AUTOPILOT_PLAYBOOK ↔ AUTOPILOT_TASKS 정합성', () => {
  it('모든 taskId 가 모듈에 클래스로 존재한다 — 완전히 빠뜨린 task 를 잡는다', async () => {
    // 새 task 클래스를 만들고 playbook 항목까지 추가했지만 module.ts 에 아예
    // import/등록하지 않은 경우를 잡는다. (반환 배열에서만 빠뜨리는 사고는 클래스명
    // 자체는 useFactory 인자·providers·inject 에 남아 있어 이 문자열 검사로는 못 잡는다
    // — 그건 아래 두 번째 테스트가 별도로 검사한다.)
    const moduleSource = await import('node:fs').then((fs) => {
      return fs.readFileSync(require.resolve('../autopilot.module'), 'utf8');
    });

    for (const entry of AUTOPILOT_PLAYBOOK) {
      const expectedClassName =
        TASK_ID_CLASS_NAME_OVERRIDE[entry.taskId] ??
        `${entry.taskId
          .split('-')
          .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
          .join('')}AutopilotTask`;
      expect(moduleSource).toContain(expectedClassName);
    }
  });

  it('AUTOPILOT_TASKS useFactory 인자와 반환 배열의 이름 집합이 정확히 같다', async () => {
    // 이게 실제 사고 재현 지점이다 — useFactory 인자·inject 에는 새 task 를 넣고
    // 반환 배열(`) => [ ... ]`)에만 빠뜨려도 컴파일·테스트·빌드가 전부 통과하고,
    // 그 task 의 슬롯이 처음 발화할 때 오케스트레이터가
    // `Autopilot: task 미등록`으로 그룹 전체를 죽인다(autopilot.orchestrator.ts,
    // autopilot.module.ts AUTOPILOT_TASKS 주석 — 실제로 겪었다). 인자 목록과 반환
    // 배열에 쓰인 식별자 집합을 직접 비교해 이 누락을 구조적으로 잡는다.
    const moduleSource = await import('node:fs').then((fs) => {
      return fs.readFileSync(require.resolve('../autopilot.module'), 'utf8');
    });
    const { paramsBlock, returnBlock } =
      extractAutopilotTasksFactoryBlocks(moduleSource);

    const declaredParams = [...paramsBlock.matchAll(/^\s*(\w+):/gm)].map(
      (match) => match[1],
    );
    const returnedNames = [...returnBlock.matchAll(/^\s*(\w+),?\s*$/gm)].map(
      (match) => match[1],
    );

    expect(declaredParams.length).toBeGreaterThan(0);
    expect([...returnedNames].sort()).toEqual([...declaredParams].sort());
  });
});
