import { AGENT_REGISTRY } from '../../agent-registry/agent-registry';
import { LedgerRunRow } from '../../agent-run/domain/port/agent-run.repository.port';
import { buildConsoleLedger } from './ledger';

const run = (
  agentType: string,
  triggerType: string,
  status: string,
  startedAt: string,
): LedgerRunRow => ({
  agentType,
  triggerType,
  status,
  startedAt: new Date(startedAt),
});

describe('buildConsoleLedger', () => {
  const mondayClock = {
    today: '2026-08-17',
    serverTime: '2026-08-17T03:00:00.000Z',
  };
  const sundayClock = {
    today: '2026-08-23',
    serverTime: '2026-08-23T03:00:00.000Z',
  };
  const thursdayClock = {
    today: '2026-08-20',
    serverTime: '2026-08-20T03:00:00.000Z',
  };

  it('오늘이 월요일이면 이번 주와 지난주를 각각 월요일 하루치만 센다', () => {
    const rows = [
      run('PM', 'MANUAL', 'SUCCEEDED', '2026-08-17T00:10:00+09:00'),
      run('PM', 'MANUAL', 'SUCCEEDED', '2026-08-10T23:50:00+09:00'),
      run('PM', 'MANUAL', 'SUCCEEDED', '2026-08-11T00:00:00+09:00'),
    ];

    const ledger = buildConsoleLedger(rows, mondayClock);

    expect(ledger.company.thisWeekRuns).toBe(1);
    expect(ledger.company.lastWeekRunsToSameWeekday).toBe(1);
  });

  it('오늘이 일요일이면 이번 주 시작을 6일 전 월요일로 계산한다', () => {
    const rows = [
      run('PM', 'MANUAL', 'SUCCEEDED', '2026-08-17T00:00:00+09:00'),
      run('PM', 'MANUAL', 'SUCCEEDED', '2026-08-16T23:59:00+09:00'),
    ];

    const ledger = buildConsoleLedger(rows, sundayClock);

    expect(ledger.company.thisWeekRuns).toBe(1);
    expect(ledger.company.lastWeekRunsToSameWeekday).toBe(1);
  });

  it('실행 이력이 없는 registry 워커도 null과 0으로 포함한다', () => {
    const ledger = buildConsoleLedger([], thursdayClock);
    const firstRegistryAgent = AGENT_REGISTRY[0];
    const agent = ledger.agents.find(
      (candidate) => candidate.agentType === firstRegistryAgent.agentType,
    );

    expect(ledger.agents).toHaveLength(AGENT_REGISTRY.length);
    expect(agent).toEqual({
      agentType: firstRegistryAgent.agentType,
      firstRunDate: null,
      totalRuns: 0,
      failedRuns: 0,
      lastRunAt: null,
      autonomy: 'NEVER_RUN',
      stalled: false,
      idleDays: null,
      autonomyIdleDays: null,
    });
    expect(ledger.company).toEqual({
      foundedDate: null,
      ageDays: 0,
      totalRuns: 0,
      failedRuns: 0,
      thisWeekRuns: 0,
      lastWeekRunsToSameWeekday: 0,
    });
  });

  it('실패 건수는 status가 FAILED인 행만 센다', () => {
    const rows = [
      run('PM', 'MANUAL', 'FAILED', '2026-08-20T01:00:00+09:00'),
      run('PM', 'MANUAL', 'SUCCEEDED', '2026-08-20T02:00:00+09:00'),
      run('PM', 'MANUAL', 'IN_PROGRESS', '2026-08-20T03:00:00+09:00'),
    ];

    const ledger = buildConsoleLedger(rows, thursdayClock);
    const pm = ledger.agents.find((agent) => agent.agentType === 'PM');

    expect(pm?.failedRuns).toBe(1);
    expect(pm).toMatchObject({
      autonomy: 'ON_DEMAND',
      stalled: false,
      autonomyIdleDays: null,
    });
    expect(ledger.company.failedRuns).toBe(1);
  });

  it('총 실행 내림차순 뒤 agentType 오름차순으로 정렬하고 registry 밖 타입도 포함한다', () => {
    const rows = [
      run('PM', 'MANUAL', 'SUCCEEDED', '2026-08-18T01:00:00+09:00'),
      run('PM', 'MANUAL', 'SUCCEEDED', '2026-08-19T01:00:00+09:00'),
      run('BE', 'MANUAL', 'SUCCEEDED', '2026-08-20T01:00:00+09:00'),
      run(
        'Z_UNKNOWN',
        'REPORT_HUMANIZE',
        'SUCCEEDED',
        '2026-08-20T02:00:00+09:00',
      ),
    ];

    const ledger = buildConsoleLedger(rows, thursdayClock);

    expect(ledger.agents.slice(0, 3).map((agent) => agent.agentType)).toEqual([
      'PM',
      'BE',
      'Z_UNKNOWN',
    ]);
  });

  it('첫 실행일·마지막 시각·idleDays·창립 일차를 KST 날짜로 계산한다', () => {
    const rows = [
      run(
        'PM',
        'MORNING_BRIEFING_CRON',
        'SUCCEEDED',
        '2026-08-18T23:50:00+09:00',
      ),
      run(
        'PM',
        'MORNING_BRIEFING_CRON',
        'SUCCEEDED',
        '2026-08-19T23:50:00+09:00',
      ),
    ];

    const ledger = buildConsoleLedger(rows, thursdayClock);
    const pm = ledger.agents.find((agent) => agent.agentType === 'PM');

    expect(pm).toMatchObject({
      firstRunDate: '2026-08-18',
      lastRunAt: '2026-08-19T14:50:00.000Z',
      idleDays: 1,
      autonomy: 'AUTONOMOUS',
      autonomyIdleDays: 1,
    });
    expect(ledger.company.foundedDate).toBe('2026-08-18');
    expect(ledger.company.ageDays).toBe(3);
    expect(ledger.serverTime).toBe('2026-08-20T03:00:00.000Z');
  });

  it('최근 수동 실행이 오래 멈춘 자율 스윕의 정지 판정을 가리지 않는다', () => {
    const rows = [
      run(
        'CODE_REVIEWER',
        'PR_REVIEW_SWEEP',
        'SUCCEEDED',
        '2026-07-11T09:00:00+09:00',
      ),
      run(
        'CODE_REVIEWER',
        'SLACK_COMMAND_REVIEW_PR',
        'SUCCEEDED',
        '2026-08-19T09:00:00+09:00',
      ),
    ];

    const ledger = buildConsoleLedger(rows, thursdayClock);
    const codeReviewer = ledger.agents.find(
      (agent) => agent.agentType === 'CODE_REVIEWER',
    );

    expect(codeReviewer).toMatchObject({
      autonomy: 'AUTONOMOUS',
      idleDays: 1,
      autonomyIdleDays: 40,
      stalled: true,
    });
  });
});
