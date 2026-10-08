import {
  AgentContractScoreRow,
  AgentRunStatRow,
} from '../../agent-run/domain/port/agent-run.repository.port';
import { AgentVerdictCountRow } from '../../agent-run/domain/port/agent-run-verdict.repository.port';
import { AgentType } from '../../model-router/domain/model-router.type';

export type RunAnomalyKind =
  | 'FAILURE_SPIKE'
  | 'LATENCY_CEILING'
  | 'AGENT_DISAPPEARED'
  | 'TOTAL_SILENCE'
  | 'CHAIN_FAILURE'
  | 'CONTRACT_SCORE'
  | 'MISSING_WEEKLY';

// TOTAL_SILENCE 는 시스템 전역 신호라 agentType 없음(null).
export interface RunAnomaly {
  agentType: string | null;
  kind: RunAnomalyKind;
  detail: string;
}

export const RUN_RETRO_THRESHOLDS = {
  failRate: 0.2,
  minFailed: 2,
  durationCeilingMs: 180_000,
  disappearMinPrev: 3,
  // 직무 계약 점수 하한. 2026-08-28 실측에서 채점된 12 종 중 11 종이 1.000 이고 하나가
  // 0.023 이라, 그 사이 어디를 잘라도 결과가 같다 — 중간값을 둔다. 값이 갈리기 시작하면
  // (부분 위반이 상시로 남는 워커가 생기면) 그때 분포를 다시 재서 정한다.
  contractScore: 0.5,
  // 표본이 적으면 한 회차의 형식 오류가 평균을 끌어내려 매주 같은 경보가 뜬다.
  minContractScored: 5,
  // 사람 판정이 이 건수 미만이면 좋음/나쁨 분포를 싣지 않고 건수만 적는다 — 두세 건의 분포는
  // 품질 숫자로 읽히기엔 너무 흔들린다(설계 docs/superpowers/specs/2026-09-30-human-feedback-channel-design.md §6).
  minVerdictsForQuality: 5,
  // 주간 cron 은 7일 주기다. 8일이면 한 회차를 확실히 건너뛴 것이며, 7일은 실행 시각이
  // 몇 분 밀린 정상 회차까지 오탐할 수 있어 경계에서 제외한다.
  weeklyMissingDays: 8,
} as const;

type Thresholds = typeof RUN_RETRO_THRESHOLDS;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// 원장에 성공 회차가 남은 뒤부터 주간 태스크 결번을 감지한다. 최초 실행 전 환경은
// 아직 감시할 기준점이 없으므로 경보를 만들지 않는다.
export const detectMissingWeeklyRuns = (
  lastSuccessAt: Map<AgentType, Date | null>,
  now: Date,
  thresholds: Thresholds = RUN_RETRO_THRESHOLDS,
): RunAnomaly[] => {
  const missing: RunAnomaly[] = [];
  for (const [agentType, endedAt] of lastSuccessAt) {
    if (endedAt === null) {
      continue;
    }
    const elapsedDays =
      (now.getTime() - endedAt.getTime()) / MILLISECONDS_PER_DAY;
    if (elapsedDays < thresholds.weeklyMissingDays) {
      continue;
    }
    missing.push({
      agentType,
      kind: 'MISSING_WEEKLY',
      detail: `주간 실행 결번 (마지막 성공 ${Math.floor(elapsedDays)}일 전)`,
    });
  }
  return missing;
};

// 두 윈도우(이번주 current, 지난주 previous)로 이상 신호를 판정하는 순수함수.
// 절대임계값(실패율·소요시간) + 사라짐(지난주 대비) + 전체침묵. 부작용 없음.
export const detectRunAnomalies = (
  current: AgentRunStatRow[],
  previous: AgentRunStatRow[],
  thresholds: Thresholds = RUN_RETRO_THRESHOLDS,
): RunAnomaly[] => {
  if (current.length === 0) {
    if (previous.length === 0) {
      return [];
    }
    const previousTotal = previous.reduce((sum, row) => sum + row.total, 0);
    return [
      {
        agentType: null,
        kind: 'TOTAL_SILENCE',
        detail: `이번주 실행 0건 (지난주 ${previousTotal}건)`,
      },
    ];
  }

  const anomalies: RunAnomaly[] = [];

  for (const row of current) {
    if (
      row.failed >= thresholds.minFailed &&
      row.failRate > thresholds.failRate
    ) {
      const percent = Math.round(row.failRate * 100);
      anomalies.push({
        agentType: row.agentType,
        kind: 'FAILURE_SPIKE',
        detail: `실패율 ${percent}% (${row.failed}/${row.total})`,
      });
    }
    if (row.avgDurationMs > thresholds.durationCeilingMs) {
      const seconds = (row.avgDurationMs / 1000).toFixed(1);
      anomalies.push({
        agentType: row.agentType,
        kind: 'LATENCY_CEILING',
        detail: `평균 ${seconds}s`,
      });
    }
  }

  const currentTypes = new Set(current.map((row) => row.agentType));
  for (const row of previous) {
    if (
      row.total >= thresholds.disappearMinPrev &&
      !currentTypes.has(row.agentType)
    ) {
      anomalies.push({
        agentType: row.agentType,
        kind: 'AGENT_DISAPPEARED',
        detail: `이번주 0건 (지난주 ${row.total}건)`,
      });
    }
  }

  return anomalies;
};

// 형식 준수율 이상 — 산출물이 계약 형식과 어긋난 채 쌓이고 있는 워커를 지목한다. 부작용 없는 순수함수.
//
// 이 판정이 없던 동안 검수는 제 몫을 했는데 **읽는 곳이 없었다**. 위반은 logger.warn 으로만
// 나가고 `contract_score` 컬럼을 조회하는 코드가 없어, 성공 실행 167 건이 전건 0 점으로
// 기록되는 동안 화면에는 아무 신호도 뜨지 않았다(2026-08-28 실측).
//
// 실패율과 달리 낮은 점수는 **실행이 성공한 채로** 남는다 — status 는 SUCCEEDED 라 다른 어떤
// 축에도 걸리지 않는다. 그래서 별도 축이 필요하다.
//
// `contract_score` 는 필수 필드가 있는지만 본다. 품질 점수로 읽히지 않도록 문구를 "형식 준수율"로
// 두고, 품질은 사람 판정(agent_run_verdict)으로만 옆에 적는다 — 사람 판정이 없는 곳에 품질 숫자를
// 쓰지 않는다(설계 §6). `verdicts` 가 null 이면 판정 조회가 실패한 것이다.
export const detectContractScoreAnomalies = (
  rows: AgentContractScoreRow[],
  verdicts: AgentVerdictCountRow[] | null,
  thresholds: Thresholds = RUN_RETRO_THRESHOLDS,
): RunAnomaly[] =>
  rows
    .filter(
      (row) =>
        row.scoredCount >= thresholds.minContractScored &&
        row.avgScore < thresholds.contractScore,
    )
    .map((row) => ({
      agentType: row.agentType,
      kind: 'CONTRACT_SCORE',
      detail:
        `형식 준수율 ${floorPercent(row.avgScore)}% ` +
        `(${row.scoredCount}건 평균, 하한 ${roundPercent(thresholds.contractScore)}% · 필수 필드 존재 여부만 검사함)` +
        ` · ${describeHumanVerdicts(row.agentType, verdicts, thresholds)}`,
    }));

// 경보 문구는 "하한 미달" 의 근거라 표시값이 하한 이상으로 보이면 안 된다 — 반올림하면 0.499 가
// "50% (하한 50%)" 로 찍힌다. 평균은 0.1%p 단위로 내림해 판정(원래 비율 < 하한)과 표시를 같은 쪽에 둔다.
// 부동소수 오차로 0.1%p 더 내려가는 경우는 있어도 올라가지는 않는다.
const floorPercent = (ratio: number): number => Math.floor(ratio * 1000) / 10;

const roundPercent = (ratio: number): number => Math.round(ratio * 1000) / 10;

const describeHumanVerdicts = (
  agentType: string,
  verdicts: AgentVerdictCountRow[] | null,
  thresholds: Thresholds,
): string => {
  if (verdicts === null) {
    return '품질: 판정 조회 실패';
  }
  const found = verdicts.find((row) => row.agentType === agentType);
  if (!found || found.total === 0) {
    return '품질: 판정 없음';
  }
  if (found.total < thresholds.minVerdictsForQuality) {
    return `품질: 판정 ${found.total}건 (${thresholds.minVerdictsForQuality}건 미만이라 좋음/나쁨 생략)`;
  }
  return `품질: 좋음 ${found.good} · 나쁨 ${found.bad} (판정 ${found.total}건)`;
};

// 한 chain(뿌리 run 하나로부터 뻗은 계보)의 실패 요약. DB 조회는 태스크가 하고 판정만 여기서 한다.
export interface ChainFailureSummary {
  rootRunId: number;
  rootAgentType: string;
  // chain 에 포함된 전체 노드 수 (뿌리 포함).
  nodeCount: number;
  // 실패한 노드들의 agentType. 비어 있으면 정상 chain.
  failedAgentTypes: string[];
}

// 계기판이 시끄러워지지 않도록 개별 표기는 이 건수까지만, 나머지는 "외 N건" 으로 접는다.
export const MAX_CHAIN_FAILURE_ANOMALIES = 3;

// chain 실패는 통계적 흔들림이 아니라 계보가 끊긴 개별 사건이라 빈도 임계를 두지 않는다.
// 실패 노드를 하나라도 포함한 chain 은 곧바로 이상으로 본다. 부작용 없는 순수함수.
export const detectChainFailureAnomalies = (
  summaries: ChainFailureSummary[],
  maxItems: number = MAX_CHAIN_FAILURE_ANOMALIES,
): RunAnomaly[] => {
  const broken = summaries.filter(
    (summary) => summary.failedAgentTypes.length > 0,
  );
  if (broken.length === 0) {
    return [];
  }
  const shown = broken.slice(0, maxItems);
  const anomalies: RunAnomaly[] = shown.map((summary) => ({
    agentType: summary.rootAgentType,
    kind: 'CHAIN_FAILURE',
    detail: `root #${summary.rootRunId} — ${summary.failedAgentTypes.join(', ')} 실패 (체인 ${summary.nodeCount}단계)`,
  }));
  const hidden = broken.length - shown.length;
  if (hidden > 0) {
    anomalies.push({
      agentType: null,
      kind: 'CHAIN_FAILURE',
      detail: `외 ${hidden}건의 체인 실패`,
    });
  }
  return anomalies;
};
