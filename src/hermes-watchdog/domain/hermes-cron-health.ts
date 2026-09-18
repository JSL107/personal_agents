import {
  DEFAULT_SCHEDULER_STALE_MS,
  HermesCronJobSnapshot,
} from './hermes-watchdog.type';

export const HERMES_CRON_ISSUE = {
  // 마지막 실행이 error 로 끝났다. 2026-09-18 아침신문이 이 상태였다(codex 쿼터 소진).
  LAST_RUN_FAILED: 'last-run-failed',
  // 실행은 됐는데 결과 전달(Slack DM 등)에 실패했다.
  DELIVERY_FAILED: 'delivery-failed',
  // 예정 시각이 지났는데 그대로다 — Hermes 스케줄러 자체가 안 돈다.
  SCHEDULER_STALLED: 'scheduler-stalled',
} as const;

export type HermesCronIssueKind =
  (typeof HERMES_CRON_ISSUE)[keyof typeof HERMES_CRON_ISSUE];

export interface HermesCronIssue {
  jobName: string;
  kind: HermesCronIssueKind;
  detail: string;
}

interface DetectHermesCronIssuesInput {
  jobs: HermesCronJobSnapshot[];
  nowMs: number;
  staleAfterMs?: number;
}

// Slack 본문에 그대로 실리므로 원문 에러를 잘라 담는다.
const DETAIL_LIMIT = 400;

const truncate = (value: string): string => {
  if (value.length <= DETAIL_LIMIT) {
    return value;
  }
  return `${value.slice(0, DETAIL_LIMIT)}…`;
};

const readNonEmpty = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// 이름이 비어 있어도 어느 job 인지 알아볼 수 있게 id 로 떨어진다.
const readJobLabel = (job: HermesCronJobSnapshot): string => {
  return readNonEmpty(job.name) ?? readNonEmpty(job.id) ?? '(이름 없는 job)';
};

// next_run_at 이 과거로 굳어 있으면 스케줄러가 멈춘 것이다. 파싱 불가한 값은
// 판정 근거가 못 되므로 조용히 넘긴다(없는 근거로 알람을 울리지 않는다).
const isSchedulerStalled = ({
  nextRunAt,
  nowMs,
  staleAfterMs,
}: {
  nextRunAt: string | null;
  nowMs: number;
  staleAfterMs: number;
}): boolean => {
  if (nextRunAt === null) {
    return false;
  }
  const nextRunAtMs = Date.parse(nextRunAt);
  if (Number.isNaN(nextRunAtMs)) {
    return false;
  }
  return nowMs - nextRunAtMs > staleAfterMs;
};

// Hermes cron 스냅샷(jobs.json)에서 사람이 개입해야 하는 상태만 골라낸다.
// enabled=false 는 일부러 꺼둔 것이므로 대상이 아니다 — 일시정지도 여기서 같이 걸러진다:
// Hermes 의 pause_job 이 enabled=false · state=paused · paused_at 을 한꺼번에 세우므로
// (hermes-agent cron/jobs.py) state 를 따로 볼 필요가 없다.
// 한 job 이 여러 조건에 걸릴 수 있어 전부 반환한다(실패 + 전달 실패 동시 등).
export const detectHermesCronIssues = ({
  jobs,
  nowMs,
  staleAfterMs = DEFAULT_SCHEDULER_STALE_MS,
}: DetectHermesCronIssuesInput): HermesCronIssue[] => {
  const issues: HermesCronIssue[] = [];

  for (const job of jobs) {
    if (job.enabled === false) {
      continue;
    }

    const jobName = readJobLabel(job);

    if (readNonEmpty(job.last_status) === 'error') {
      issues.push({
        jobName,
        kind: HERMES_CRON_ISSUE.LAST_RUN_FAILED,
        detail: truncate(
          readNonEmpty(job.last_error) ?? '(last_error 가 비어 있음)',
        ),
      });
    }

    const deliveryError = readNonEmpty(job.last_delivery_error);
    if (deliveryError !== null) {
      issues.push({
        jobName,
        kind: HERMES_CRON_ISSUE.DELIVERY_FAILED,
        detail: truncate(deliveryError),
      });
    }

    if (
      isSchedulerStalled({
        nextRunAt: readNonEmpty(job.next_run_at),
        nowMs,
        staleAfterMs,
      })
    ) {
      issues.push({
        jobName,
        kind: HERMES_CRON_ISSUE.SCHEDULER_STALLED,
        detail: `예정 시각 ${String(job.next_run_at)} 이 지났는데 갱신되지 않았다.`,
      });
    }
  }

  return issues;
};

const ISSUE_LABEL: Record<HermesCronIssueKind, string> = {
  [HERMES_CRON_ISSUE.LAST_RUN_FAILED]: '실행 실패',
  [HERMES_CRON_ISSUE.DELIVERY_FAILED]: '전달 실패',
  [HERMES_CRON_ISSUE.SCHEDULER_STALLED]: '스케줄러 멈춤',
};

// NotificationPublisher.publishCronFailure 의 errorMessage 로 실리는 한 덩어리 본문.
export const formatHermesCronIssues = (issues: HermesCronIssue[]): string => {
  return issues
    .map(
      (issue) =>
        `• [${ISSUE_LABEL[issue.kind]}] ${issue.jobName} — ${issue.detail}`,
    )
    .join('\n');
};
