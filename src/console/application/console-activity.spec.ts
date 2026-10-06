import { buildConsoleActivity, toTaskTitle } from './console-activity';

describe('toTaskTitle', () => {
  it.each([
    ['#536 리뷰 중', '#536 리뷰'],
    ['아침 계획 짜는 중', '아침 계획 짜기'],
    ['하루 회고 쓰는 중', '하루 회고 쓰기'],
    ['휴가 계산 중', '휴가 계산'],
  ])('%s → %s', (bubble, expected) => {
    expect(toTaskTitle(bubble)).toBe(expected);
  });
});

describe('buildConsoleActivity', () => {
  const clock = {
    today: '2026-10-06',
    serverTime: '2026-10-06T03:00:00.000Z',
    dayCount: 3,
    recentLimit: 2,
  };

  it('KST 날짜별로 성공·실패·기타를 세고 실행 없는 날은 0으로 채운다', () => {
    const result = buildConsoleActivity(
      [
        // KST 10-06 00:30 — UTC 로는 전날이지만 오늘로 들어가야 한다.
        {
          agentType: 'PM',
          status: 'SUCCEEDED',
          startedAt: new Date('2026-10-05T15:30:00Z'),
        },
        {
          agentType: 'PM',
          status: 'FAILED',
          startedAt: new Date('2026-10-06T01:00:00Z'),
        },
        {
          agentType: 'PM',
          status: 'IN_PROGRESS',
          startedAt: new Date('2026-10-06T02:00:00Z'),
        },
        {
          agentType: 'PM',
          status: 'SUCCEEDED',
          startedAt: new Date('2026-10-04T01:00:00Z'),
        },
        // 창 밖(10-03 KST)은 버린다.
        {
          agentType: 'PM',
          status: 'SUCCEEDED',
          startedAt: new Date('2026-10-03T01:00:00Z'),
        },
      ],
      [],
      clock,
    );

    expect(result.days).toEqual([
      { date: '2026-10-04', succeeded: 1, failed: 0, other: 0 },
      { date: '2026-10-05', succeeded: 0, failed: 0, other: 0 },
      { date: '2026-10-06', succeeded: 1, failed: 1, other: 1 },
    ]);
  });

  it('최근 실행은 말풍선 규칙으로 제목을 붙이고 규칙이 없으면 자동/직접만 남긴다', () => {
    const result = buildConsoleActivity(
      [],
      [
        {
          id: 7,
          agentType: 'CODE_REVIEWER',
          triggerType: 'PR_REVIEW_SWEEP',
          status: 'SUCCEEDED',
          startedAt: new Date('2026-10-06T02:00:00Z'),
          endedAt: new Date('2026-10-06T02:01:00Z'),
          inputSnapshot: { pullNumber: 536 },
        },
        {
          id: 6,
          agentType: 'PM',
          triggerType: 'UNKNOWN_SLACK_THING',
          status: 'FAILED',
          startedAt: new Date('2026-10-06T01:00:00Z'),
          endedAt: null,
          inputSnapshot: null,
        },
      ],
      clock,
    );

    expect(result.recentRuns).toEqual([
      {
        id: '7',
        agentType: 'CODE_REVIEWER',
        status: 'SUCCEEDED',
        title: '#536 리뷰',
        startedAt: '2026-10-06T02:00:00.000Z',
        finishedAt: '2026-10-06T02:01:00.000Z',
        count: 1,
      },
      {
        id: '6',
        agentType: 'PM',
        status: 'FAILED',
        title: '직접 지시',
        startedAt: '2026-10-06T01:00:00.000Z',
        finishedAt: null,
        count: 1,
      },
    ]);
    expect(result.serverTime).toBe(clock.serverTime);
  });
});

describe('buildConsoleActivity 최근 실행 묶기', () => {
  const clock = {
    today: '2026-10-06',
    serverTime: '2026-10-06T03:00:00.000Z',
    dayCount: 1,
    recentLimit: 2,
  };
  const tick = (id: number, status = 'SUCCEEDED') => ({
    id,
    agentType: 'PAPER_TRADE',
    triggerType: 'AUTOPILOT_PAPER_INTRADAY_STOP_CRON',
    status,
    startedAt: new Date(
      `2026-10-06T02:${String(60 - id).padStart(2, '0')}:00Z`,
    ),
    endedAt: null,
    inputSnapshot: null,
  });

  it('연달아 같은 일·결과는 한 줄로 묶고 최신 시각을 남기며, 줄 수 상한 뒤는 버린다', () => {
    const result = buildConsoleActivity(
      [],
      [tick(9), tick(8), tick(7), tick(6, 'FAILED'), tick(5), tick(4)],
      clock,
    );

    expect(
      result.recentRuns.map((run) => [
        run.id,
        run.title,
        run.status,
        run.count,
      ]),
    ).toEqual([
      ['9', '장중 손절 점검', 'SUCCEEDED', 3],
      ['6', '장중 손절 점검', 'FAILED', 1],
    ]);
  });
});
