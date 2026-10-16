import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

// 다음 정기 회차가 이만큼 안에 오면 보충하지 않는다 — 3분·10분·매시 주기는 곧 다시 돌고,
// 하루 두 번 도는 작업도 남은 회차가 놓친 몫을 처리한다.
export const MISSED_RUN_MIN_GAP_MS = 60 * 60_000;

// 반복 작업 이름 → 앱이 꺼진 사이 지나가 버린 예정 시각.
export type MissedRuns = ReadonlyMap<string, number>;

/**
 * 부팅 때 repeatable 을 지우기 **전에** 부른다.
 *
 * 스케줄러들은 부팅마다 repeatable 을 지우고 다시 건다. 지우면 대기 중이던 회차도 같이
 * 지워지고 새 등록은 다음 회차를 지금부터 세므로, 앱이 꺼진 사이 지나간 회차는 기록도
 * 알림도 없이 사라진다(2026-10-16 07:30 대 Study Brief·job-feed 실측). 대기 회차 시각
 * (`next`)이 이미 과거라는 것이 「그 회차가 돌지 못했다」는 신호다 — 실행이 시작되면
 * BullMQ 가 그 순간 다음 회차로 `next` 를 넘기므로, 돌다 실패한 회차는 여기 잡히지 않는다.
 */
export const snapshotMissedRuns = async (
  queue: Queue,
  now: number = Date.now(),
): Promise<MissedRuns> => {
  const missed = new Map<string, number>();
  for (const job of await queue.getRepeatableJobs()) {
    if (job.next !== undefined && job.next < now) {
      missed.set(job.name, job.next);
    }
  }
  return missed;
};

/**
 * 정기 등록을 **마친 뒤** 부른다. 놓친 회차마다 같은 data·재시도 옵션으로 한 번 실행을 넣는다.
 *
 * data 와 옵션은 방금 등록한 repeatable 의 대기 job 에서 읽는다 — 스케줄러마다 payload 를
 * 다시 넘기지 않아도 정기 실행과 똑같이 돈다. jobId 에 놓친 시각을 넣어, 같은 회차를 두고
 * 여러 번 재부팅해도 한 번만 들어간다(그 사이 `next` 도 미래로 넘어가 다시 잡히지 않는다).
 * 여러 날 꺼져 있었어도 한 번만 보충한다 — 지난 날짜 몫을 몰아서 보내지 않는다.
 */
export const enqueueMissedRuns = async (
  queue: Queue,
  missed: MissedRuns,
  logger: Logger,
  options: {
    shouldCatchUp?: (name: string) => boolean;
    now?: number;
  } = {},
): Promise<void> => {
  if (missed.size === 0) {
    return;
  }
  const now = options.now ?? Date.now();
  for (const repeatable of await queue.getRepeatableJobs()) {
    const missedAt = missed.get(repeatable.name);
    if (missedAt === undefined || repeatable.next === undefined) {
      continue;
    }
    if (options.shouldCatchUp && !options.shouldCatchUp(repeatable.name)) {
      logger.log(`[${repeatable.name}] 놓친 회차 보충 제외 대상 — 건너뛴다`);
      continue;
    }
    if (repeatable.next - now <= MISSED_RUN_MIN_GAP_MS) {
      continue;
    }
    const pending = await queue.getJob(
      `repeat:${repeatable.key}:${repeatable.next}`,
    );
    if (!pending) {
      logger.warn(
        `[${repeatable.name}] 놓친 회차가 있으나 대기 job 을 못 찾아 보충하지 못했다 (예정 ${new Date(missedAt).toISOString()})`,
      );
      continue;
    }
    await queue.add(repeatable.name, pending.data, {
      jobId: `catchup-${repeatable.name.replaceAll(':', '-')}-${missedAt}`,
      attempts: pending.opts.attempts,
      backoff: pending.opts.backoff,
      removeOnComplete: 20,
      removeOnFail: 20,
    });
    logger.warn(
      `[${repeatable.name}] 놓친 회차 보충 — 예정 ${new Date(missedAt).toISOString()} 에 앱이 꺼져 있었다`,
    );
  }
};
