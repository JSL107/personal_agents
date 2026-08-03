import { STALE_RUN_THRESHOLD_MINUTES } from '../../agent-run/domain/agent-run.type';
import {
  ActiveRunSnapshot,
  AgentSucceededCountRow,
  FailedRunDetail,
} from '../../agent-run/domain/port/agent-run.repository.port';
import { PreviewAction } from '../../preview-gate/domain/preview-action.type';

/**
 * 비서실 — 흩어진 하루치 사실을 한 장으로 접는다.
 *
 * 결과를 다시 만들지 않는다. 각 부서(에이전트)가 이미 낸 실행 기록과 승인 카드를
 * 세어 옮길 뿐이고, LLM 을 호출하지 않는다. PreviewGate 처럼 무언가를 막는 장치도
 * 아니다 — 게이트는 되돌리기 어려운 행동 직전에 건별로 멈춰 세우는 것이고,
 * 비서실은 이미 벌어진 일을 모아 하루 한 번 보고한다.
 *
 * 설계 근거: `docs/superpowers/specs/2026-07-31-idaeri-company-rules-design.md`
 */

/** 같은 에이전트가 이만큼 실패하면 사람이 볼 일로 올린다. 1회는 다음 슬롯 재시도로 풀린다. */
const UNRESOLVED_FAILURE_THRESHOLD = 2;

/**
 * 결정 후보로 올리려면 최소 이만큼은 남아 있어야 한다.
 *
 * 브리핑은 아침에 한 번 발송되고 대표가 그걸 읽는 데까지 시간이 걸린다. 곧 만료될 카드를
 * "오늘 결정할 것" 으로 올리면 읽는 시점엔 이미 사라져 있다. 실측(2026-08-03)에서 TTL
 * 30분짜리 세션 주입 카드가 "3분 뒤 만료" 상태로 1순위를 차지했다 — 만료 임박순 정렬이
 * 오히려 실행 불가능한 항목을 맨 앞에 세운다.
 *
 * ③ 목록에는 그대로 남는다. 거긴 "지금 무엇이 대기 중인가" 라는 사실이고,
 * ⑤ 는 "오늘 실제로 할 수 있는 결정" 이다.
 */
const DECISION_MIN_LEAD_MS = 60 * 60 * 1000;

/** 승인 카드 제목 표시 상한. 넘으면 말줄임. */
const APPROVAL_LABEL_MAX_LENGTH = 60;

export interface SecretariatCompletedRow {
  agentType: string;
  count: number;
}

export interface SecretariatApprovalRow {
  label: string;
  expiresAt: Date;
}

export interface SecretariatBlockedRow {
  agentType: string;
  /** 같은 에이전트의 실패 중 가장 최근 것의 이유. */
  reason: string;
  /** 관측 창 안의 실패 **건수**. 연속 실패 횟수가 아니다 — 사이에 성공이 있었을 수 있다. */
  count: number;
}

/** 오늘 대표가 결정할 것 — 최대 1건. 승인 피로를 줄이는 게 목적이라 더 늘리지 않는다. */
export type SecretariatDecision =
  | { kind: 'APPROVAL'; label: string; expiresAt: Date }
  | {
      kind: 'UNRESOLVED_FAILURE';
      agentType: string;
      reason: string;
      count: number;
    };

export interface SecretariatDigest {
  completed: SecretariatCompletedRow[];
  /** 지금 실행 중인 에이전트 종류. 좀비(임계 초과 IN_PROGRESS)는 제외한다. */
  inProgress: string[];
  approvals: SecretariatApprovalRow[];
  blocked: SecretariatBlockedRow[];
  decision: SecretariatDecision | null;
}

export interface BuildSecretariatDigestInput {
  /** agentType 별 성공 건수. 진행 중인 런은 여기 들어오지 않는다. */
  succeeded: AgentSucceededCountRow[];
  activeRuns: ActiveRunSnapshot[];
  openPreviews: PreviewAction[];
  failedRuns: FailedRunDetail[];
  /**
   * 마지막 종료가 실패인 에이전트 — 즉 **아직 복구되지 않은** 것.
   *
   * `failedRuns` 만으로는 복구 여부를 알 수 없다. 실패 목록에는 이후 재시도가 성공해
   * 이미 해결된 건도 그대로 남아 있어서, 그것까지 "막힌 것" 으로 보고하면 대표가 이미
   * 끝난 문제를 다시 들여다보게 된다.
   */
  unresolvedAgentTypes: string[];
  now: Date;
}

const toApprovalLabel = (previewText: string): string => {
  const firstLine = previewText.split('\n')[0]?.trim() ?? '';
  if (firstLine.length === 0) {
    return '(제목 없는 승인 카드)';
  }
  if (firstLine.length <= APPROVAL_LABEL_MAX_LENGTH) {
    return firstLine;
  }
  return `${firstLine.slice(0, APPROVAL_LABEL_MAX_LENGTH)}…`;
};

const buildCompleted = (
  succeeded: AgentSucceededCountRow[],
): SecretariatCompletedRow[] =>
  succeeded
    .map((row) => ({ agentType: row.agentType, count: row.succeeded }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count);

const buildInProgress = (
  activeRuns: ActiveRunSnapshot[],
  now: Date,
): string[] => {
  // 콘솔 스냅샷과 같은 기준으로 좀비를 걸러낸다. run-sweeper 는 주 1회라, 스윕 전까지
  // 죽은 런이 "일하는 중" 으로 남아 매일 아침 있지도 않은 진행 중 작업을 보고하게 된다.
  const staleCutoffMs = now.getTime() - STALE_RUN_THRESHOLD_MINUTES * 60_000;
  const fresh = activeRuns.filter(
    (run) => run.startedAt.getTime() >= staleCutoffMs,
  );
  return [...new Set(fresh.map((run) => run.agentType))].sort();
};

const buildApprovals = (
  openPreviews: PreviewAction[],
): SecretariatApprovalRow[] =>
  openPreviews
    .map((preview) => ({
      label: toApprovalLabel(preview.previewText),
      expiresAt: preview.expiresAt,
    }))
    // 만료가 임박한 순 — 첫 항목이 그대로 "오늘 결정할 것" 후보가 된다.
    .sort(
      (left, right) => left.expiresAt.getTime() - right.expiresAt.getTime(),
    );

const buildBlocked = (
  failedRuns: FailedRunDetail[],
  unresolvedAgentTypes: string[],
): SecretariatBlockedRow[] => {
  const unresolved = new Set(unresolvedAgentTypes);
  const grouped = new Map<string, SecretariatBlockedRow>();
  // 입력이 최신순이므로 각 agentType 의 첫 등장이 가장 최근 실패다.
  for (const run of [...failedRuns].sort(
    (left, right) => right.endedAt.getTime() - left.endedAt.getTime(),
  )) {
    // 이후 성공으로 복구된 에이전트는 빼낸다 — 이미 끝난 문제다.
    if (unresolved.has(run.agentType) === false) {
      continue;
    }
    const found = grouped.get(run.agentType);
    if (found) {
      found.count += 1;
      continue;
    }
    grouped.set(run.agentType, {
      agentType: run.agentType,
      reason: run.reason,
      count: 1,
    });
  }
  return [...grouped.values()].sort((left, right) => right.count - left.count);
};

/**
 * 오늘 결정할 것 하나를 고른다.
 *
 * 승인 카드가 먼저다 — 만료되면 그날 일이 통째로 유실되므로 시한이 붙은 유일한 항목이다.
 * 단 읽고 반응할 시간이 남은 카드만 고른다(`DECISION_MIN_LEAD_MS`).
 * 카드가 없을 때만 미복구 실패를 올린다. 1회 실패는 다음 슬롯이 알아서 재시도하니
 * 대표가 볼 일이 아니다.
 */
const pickDecision = (
  approvals: SecretariatApprovalRow[],
  blocked: SecretariatBlockedRow[],
  now: Date,
): SecretariatDecision | null => {
  // 입력이 만료 임박순이라, 조건을 만족하는 첫 카드가 곧 "가장 급하되 아직 할 수 있는 것".
  const soonest = approvals.find(
    (row) => row.expiresAt.getTime() - now.getTime() >= DECISION_MIN_LEAD_MS,
  );
  if (soonest) {
    return {
      kind: 'APPROVAL',
      label: soonest.label,
      expiresAt: soonest.expiresAt,
    };
  }
  const unresolved = blocked.find(
    (row) => row.count >= UNRESOLVED_FAILURE_THRESHOLD,
  );
  if (unresolved) {
    return {
      kind: 'UNRESOLVED_FAILURE',
      agentType: unresolved.agentType,
      reason: unresolved.reason,
      count: unresolved.count,
    };
  }
  return null;
};

export const buildSecretariatDigest = ({
  succeeded,
  activeRuns,
  openPreviews,
  failedRuns,
  unresolvedAgentTypes,
  now,
}: BuildSecretariatDigestInput): SecretariatDigest => {
  const approvals = buildApprovals(openPreviews);
  const blocked = buildBlocked(failedRuns, unresolvedAgentTypes);
  return {
    completed: buildCompleted(succeeded),
    inProgress: buildInProgress(activeRuns, now),
    approvals,
    blocked,
    decision: pickDecision(approvals, blocked, now),
  };
};

/**
 * 네 항목이 모두 비었는가 — 앱이 멈춰 있던 날이다.
 *
 * 이때는 보고를 내지 않는다(`run-retro` 의 "조용한 계기판" 과 같은 판단). 같은 그룹의
 * 아침 브리핑은 그대로 나가므로 대표가 아무 소식도 못 받는 상황은 생기지 않는다.
 * `decision` 은 판정에 넣지 않는다 — 네 항목에서 파생되므로 항상 함께 빈다.
 */
export const isSecretariatDigestEmpty = (digest: SecretariatDigest): boolean =>
  digest.completed.length === 0 &&
  digest.inProgress.length === 0 &&
  digest.approvals.length === 0 &&
  digest.blocked.length === 0;
