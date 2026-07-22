import { AgentRunStatRow } from '../../agent-run/domain/port/agent-run.repository.port';
import {
  ChainFailureSummary,
  detectChainFailureAnomalies,
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
