import { AgentRunStatRow } from '../../agent-run/domain/port/agent-run.repository.port';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  ChainFailureSummary,
  detectChainFailureAnomalies,
  detectContractScoreAnomalies,
  detectMissingWeeklyRuns,
  detectRunAnomalies,
} from './run-retro.anomaly';

const row = (over: Partial<AgentRunStatRow>): AgentRunStatRow => ({
  agentType: 'PM',
  total: 10,
  failed: 0,
  failRate: 0,
  avgDurationMs: 40_000,
  ...over,
});

describe('detectRunAnomalies', () => {
  it('모두 정상이면 빈 배열', () => {
    expect(detectRunAnomalies([row({})], [row({})])).toEqual([]);
  });

  it('FAILURE_SPIKE: 실패율>20% AND 실패>=2', () => {
    const result = detectRunAnomalies(
      [row({ total: 6, failed: 2, failRate: 2 / 6 })],
      [row({})],
    );
    expect(result).toEqual([
      expect.objectContaining({ agentType: 'PM', kind: 'FAILURE_SPIKE' }),
    ]);
  });

  it('FAILURE_SPIKE guard: 실패 1건이면 100%여도 무시', () => {
    const result = detectRunAnomalies(
      [row({ total: 1, failed: 1, failRate: 1 })],
      [row({})],
    );
    expect(result).toEqual([]);
  });

  it('LATENCY_CEILING: 평균>180s', () => {
    const result = detectRunAnomalies(
      [row({ avgDurationMs: 201_000 })],
      [row({})],
    );
    expect(result).toEqual([
      expect.objectContaining({ kind: 'LATENCY_CEILING', agentType: 'PM' }),
    ]);
  });

  it('AGENT_DISAPPEARED: 지난주>=3인데 이번주 없음', () => {
    const result = detectRunAnomalies(
      [row({ agentType: 'WORK_REVIEWER', total: 5 })],
      [row({ agentType: 'PM', total: 10 })],
    );
    expect(result).toEqual([
      expect.objectContaining({ kind: 'AGENT_DISAPPEARED', agentType: 'PM' }),
    ]);
  });

  it('AGENT_DISAPPEARED guard: 지난주<3(이벤트성)이면 사라짐 무시', () => {
    const result = detectRunAnomalies(
      [row({ agentType: 'WORK_REVIEWER', total: 5 })],
      [row({ agentType: 'VACATION', total: 1 })],
    );
    expect(result).toEqual([]);
  });

  it('TOTAL_SILENCE: 이번주 0건 AND 지난주 있음', () => {
    const result = detectRunAnomalies(
      [],
      [row({ total: 10 }), row({ agentType: 'CEO', total: 5 })],
    );
    expect(result).toEqual([
      expect.objectContaining({ kind: 'TOTAL_SILENCE', agentType: null }),
    ]);
  });

  it('둘 다 비면 빈 배열(skip 은 호출부가 판단)', () => {
    expect(detectRunAnomalies([], [])).toEqual([]);
  });
});

const buildChainSummary = (
  override: Partial<ChainFailureSummary> = {},
): ChainFailureSummary => ({
  rootRunId: 42,
  rootAgentType: 'PM',
  nodeCount: 3,
  failedAgentTypes: ['CTO'],
  ...override,
});

describe('detectChainFailureAnomalies — 체인 실패 지목', () => {
  it('실패 노드 없는 체인은 이상이 아니다', () => {
    expect(
      detectChainFailureAnomalies([
        buildChainSummary({ failedAgentTypes: [] }),
      ]),
    ).toEqual([]);
  });

  it('빈 입력이면 빈 배열', () => {
    expect(detectChainFailureAnomalies([])).toEqual([]);
  });

  it('실패 노드가 하나라도 있으면 root 와 실패 지점을 지목한다', () => {
    const anomalies = detectChainFailureAnomalies([buildChainSummary()]);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].kind).toBe('CHAIN_FAILURE');
    expect(anomalies[0].agentType).toBe('PM');
    expect(anomalies[0].detail).toContain('#42');
    expect(anomalies[0].detail).toContain('CTO');
  });

  it('표기 상한을 넘으면 나머지는 "외 N건" 으로 접는다 (계기판 소음 방지)', () => {
    const summaries = [1, 2, 3, 4, 5].map((seq) =>
      buildChainSummary({ rootRunId: seq }),
    );

    const anomalies = detectChainFailureAnomalies(summaries, 3);

    expect(anomalies).toHaveLength(4);
    expect(anomalies[3].agentType).toBeNull();
    expect(anomalies[3].detail).toContain('외 2건');
  });
});

describe('detectContractScoreAnomalies', () => {
  // 2026-08-28 실측값 그대로 — PAPER_TRADE 171건 평균 0.023, 나머지 워커는 1.000.
  it('하한 아래인 워커를 형식 준수율로 지목한다 (품질 점수로 읽히지 않게)', () => {
    const anomalies = detectContractScoreAnomalies(
      [
        { agentType: 'PAPER_TRADE', scoredCount: 171, avgScore: 0.023 },
        { agentType: 'HUMANIZER', scoredCount: 66, avgScore: 1 },
      ],
      [],
    );

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].agentType).toBe('PAPER_TRADE');
    expect(anomalies[0].kind).toBe('CONTRACT_SCORE');
    expect(anomalies[0].detail).toBe(
      '형식 준수율 2.3% (171건 평균, 하한 50% · 필수 필드 존재 여부만 검사함) · 품질: 판정 없음',
    );
    expect(anomalies[0].detail).not.toContain('계약 점수');
  });

  // 표본이 적으면 한 회차의 형식 오류가 평균을 끌어내려 매주 같은 경보가 뜬다.
  it('표본이 하한 미만이면 지목하지 않는다', () => {
    const anomalies = detectContractScoreAnomalies(
      [{ agentType: 'CTO', scoredCount: 4, avgScore: 0 }],
      [],
    );

    expect(anomalies).toEqual([]);
  });

  // 판정은 원래 비율로 하므로, 표시가 반올림이면 0.499 가 "50% (하한 50%)" 로 찍혀 경보 근거가 사라진다.
  it.each([
    [0.499, '형식 준수율 49.9% (10건 평균, 하한 50%'],
    [0.4999, '형식 준수율 49.9% (10건 평균, 하한 50%'],
  ])(
    '하한 바로 아래(%s)는 표시값도 하한보다 작게 내림한다',
    (avgScore, expected) => {
      const anomalies = detectContractScoreAnomalies(
        [{ agentType: 'PM', scoredCount: 10, avgScore }],
        [],
      );

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].detail).toContain(expected);
    },
  );

  it('점수가 하한 이상이면 조용하다 (계기판 소음 방지)', () => {
    const anomalies = detectContractScoreAnomalies(
      [{ agentType: 'PM', scoredCount: 20, avgScore: 0.5 }],
      [{ agentType: 'PM', total: 9, good: 1, bad: 8 }],
    );

    expect(anomalies).toEqual([]);
  });

  describe('사람 판정 병기 (설계 §6 — 판정 없는 곳에 품질 숫자를 쓰지 않는다)', () => {
    const lowScore = [{ agentType: 'PM', scoredCount: 10, avgScore: 0.3 }];
    const detail = (
      verdicts: Parameters<typeof detectContractScoreAnomalies>[1],
    ): string => detectContractScoreAnomalies(lowScore, verdicts)[0].detail;

    it('판정 5건 이상이면 좋음/나쁨/건수를 싣는다', () => {
      expect(
        detail([{ agentType: 'PM', total: 5, good: 3, bad: 1 }]),
      ).toContain('품질: 좋음 3 · 나쁨 1 (판정 5건)');
    });

    it('판정 5건 미만이면 좋음/나쁨 없이 건수만 싣는다', () => {
      const text = detail([{ agentType: 'PM', total: 4, good: 4, bad: 0 }]);

      expect(text).toContain('품질: 판정 4건 (5건 미만이라 좋음/나쁨 생략)');
      expect(text).not.toContain('좋음 4');
    });

    it('그 agentType 의 판정이 없으면 "판정 없음" — 다른 워커 판정을 끌어오지 않는다', () => {
      expect(
        detail([{ agentType: 'PO_SHADOW', total: 9, good: 9, bad: 0 }]),
      ).toContain('품질: 판정 없음');
    });

    it('판정 조회가 실패했으면(null) "판정 없음" 이 아니라 조회 실패로 적는다', () => {
      const text = detail(null);

      expect(text).toContain('품질: 판정 조회 실패');
      expect(text).not.toContain('판정 없음');
    });
  });
});

describe('detectMissingWeeklyRuns', () => {
  const now = new Date('2026-09-07T00:00:00.000Z');

  it('마지막 성공이 정확히 7일 전이면 결번으로 보지 않는다', () => {
    const lastSuccessAt = new Map<AgentType, Date | null>([
      [AgentType.BLOG_REVISION, new Date('2026-08-31T00:00:00.000Z')],
    ]);

    expect(detectMissingWeeklyRuns(lastSuccessAt, now)).toEqual([]);
  });

  it('8일 경계 직전 1ms는 결번으로 보지 않는다', () => {
    const lastSuccessAt = new Map<AgentType, Date | null>([
      [AgentType.BLOG_REVISION, new Date('2026-08-30T00:00:00.001Z')],
    ]);

    expect(detectMissingWeeklyRuns(lastSuccessAt, now)).toEqual([]);
  });

  it('마지막 성공이 정확히 8일 전이면 결번으로 감지한다', () => {
    const lastSuccessAt = new Map<AgentType, Date | null>([
      [AgentType.BLOG_REVISION, new Date('2026-08-30T00:00:00.000Z')],
    ]);

    expect(detectMissingWeeklyRuns(lastSuccessAt, now)).toEqual([
      expect.objectContaining({
        agentType: AgentType.BLOG_REVISION,
        kind: 'MISSING_WEEKLY',
      }),
    ]);
  });

  it('마지막 성공이 8일을 넘겨도 결번으로 감지한다', () => {
    const lastSuccessAt = new Map<AgentType, Date | null>([
      [AgentType.BLOG_REVISION, new Date('2026-08-20T00:00:00.000Z')],
    ]);

    expect(detectMissingWeeklyRuns(lastSuccessAt, now)).toEqual([
      expect.objectContaining({
        agentType: AgentType.BLOG_REVISION,
        kind: 'MISSING_WEEKLY',
      }),
    ]);
  });

  it('최초 실행 전(null)은 결번으로 보고하지 않는다', () => {
    const lastSuccessAt = new Map<AgentType, Date | null>([
      [AgentType.BLOG_REVISION, null],
    ]);

    expect(detectMissingWeeklyRuns(lastSuccessAt, now)).toEqual([]);
  });
});
