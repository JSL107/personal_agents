import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

// 다음 정기 회차가 이만큼 안에 오면 보충을 취소한다 — 3분·10분·매시 주기는 곧 다시 돌고,
// 하루 두 번 도는 작업도 남은 회차가 놓친 몫을 처리한다.
export const MISSED_RUN_MIN_GAP_MS = 60 * 60_000;

// 반복 작업 이름 → 보충으로 넣은 job id.
export type CatchUpJobs = ReadonlyMap<string, string>;

/**
 * 부팅 때 repeatable 을 지우기 **전에** 부른다. 앱이 꺼진 사이 지나간 회차를 보충 job 으로 넣는다.
 *
 * 스케줄러들은 부팅마다 repeatable 을 지우고 다시 건다. 지우면 대기 중이던 회차도 같이
 * 지워지고 새 등록은 다음 회차를 지금부터 세므로, 앱이 꺼진 사이 지나간 회차는 기록도
 * 알림도 없이 사라진다(2026-10-16 07:30 대 Study Brief·job-feed 실측). 대기 회차 시각
 * (`next`)이 이미 과거라는 것이 「그 회차가 돌지 못했다」는 신호다.
 *
 * 지우기 전에 넣는 이유: 지운 뒤에 넣다가 그 사이 프로세스가 죽거나 add 가 실패하면, 다음
 * 부팅에서는 `next` 가 이미 미래라 놓친 회차를 다시 찾을 길이 없다. 먼저 넣어 두면 add 가
 * 실패해도 repeatable 이 그대로라 다음 부팅이 다시 찾는다.
 *
 * 전제: 이 시점에 같은 큐의 worker 가 아직 돌지 않는다. worker 는 루트 AppModule 의
 * WorkerStartupCoordinator 가 모든 하위 모듈의 onApplicationBootstrap 이 끝난 뒤 켠다.
 * worker 가 먼저 돌면 지나간 회차가 스스로 실행되는 동시에 보충도 들어가 두 번 돈다.
 *
 * data 와 재시도 옵션은 지나간 대기 job 에서 그대로 옮긴다. jobId 에 놓친 시각을 넣어, 같은
 * 회차를 두고 여러 번 재부팅해도 한 번만 들어간다. 여러 날 꺼져 있었어도 한 번만 넣는다 —
 * 대기 job 은 꺼진 뒤 첫 회차 하나뿐이다.
 */
export const enqueueMissedRuns = async (
  queue: Queue,
  logger: Logger,
  options: {
    shouldCatchUp?: (name: string) => boolean;
    now?: number;
  } = {},
): Promise<CatchUpJobs> => {
  const now = options.now ?? Date.now();
  const added = new Map<string, string>();
  for (const repeatable of await queue.getRepeatableJobs()) {
    const missedAt = repeatable.next;
    if (missedAt === undefined || missedAt >= now) {
      continue;
    }
    if (options.shouldCatchUp && !options.shouldCatchUp(repeatable.name)) {
      logger.log(`[${repeatable.name}] 놓친 회차 보충 제외 대상 — 건너뛴다`);
      continue;
    }
    const pending = await queue.getJob(`repeat:${repeatable.key}:${missedAt}`);
    if (!pending) {
      logger.warn(
        `[${repeatable.name}] 놓친 회차가 있으나 대기 job 을 못 찾아 보충하지 못했다 (예정 ${new Date(missedAt).toISOString()})`,
      );
      continue;
    }
    const jobId = `catchup-${repeatable.name.replaceAll(':', '-')}-${missedAt}`;
    await queue.add(repeatable.name, pending.data, {
      jobId,
      attempts: pending.opts.attempts,
      backoff: pending.opts.backoff,
      removeOnComplete: 20,
      removeOnFail: 20,
    });
    added.set(repeatable.name, jobId);
    logger.warn(
      `[${repeatable.name}] 놓친 회차 보충 — 예정 ${new Date(missedAt).toISOString()} 에 앱이 꺼져 있었다`,
    );
  }
  return added;
};

/**
 * 정기 등록을 **마친 뒤** 부른다. 다음 정기 회차가 곧 오는 작업은 보충을 취소한다.
 *
 * 취소에 실패해도 경고만 남긴다 — 보충이 한 번 더 도는 것이 회차를 잃는 것보다 낫고,
 * 부팅을 막을 일이 아니다.
 */
export const cancelCatchUpsDueSoon = async (
  queue: Queue,
  catchUps: CatchUpJobs,
  logger: Logger,
  now: number = Date.now(),
): Promise<void> => {
  if (catchUps.size === 0) {
    return;
  }
  try {
    for (const repeatable of await queue.getRepeatableJobs()) {
      const jobId = catchUps.get(repeatable.name);
      if (
        jobId === undefined ||
        repeatable.next === undefined ||
        repeatable.next - now > MISSED_RUN_MIN_GAP_MS
      ) {
        continue;
      }
      await queue.remove(jobId);
      logger.log(
        `[${repeatable.name}] 다음 정기 회차가 곧 와서 놓친 회차 보충을 취소한다`,
      );
    }
  } catch (error: unknown) {
    logger.warn(
      `놓친 회차 보충 취소 실패 — 보충이 그대로 돈다: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

// 놓친 회차를 보충한 뒤 이전 등록을 지워 새 스케줄로 교체한다.
export const removeAllRepeatables = async (queue: Queue): Promise<void> => {
  const repeatables = await queue.getRepeatableJobs();
  for (const job of repeatables) {
    await queue.removeRepeatableByKey(job.key);
  }
};

// 빈 설정은 기본값을 써서 재등록할 스케줄을 유효하게 유지한다.
export const readNonEmptyConfig = ({
  configService,
  key,
  fallback,
}: {
  configService: ConfigService;
  key: string;
  fallback: string;
}): string => {
  const trimmed = configService.get<string>(key)?.trim() ?? '';
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed;
};
