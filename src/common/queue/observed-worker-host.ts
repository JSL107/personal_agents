import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

// BullMQ 가 export 하지 않는 lua 안의 문자열(moveStalledJobsToWait-8.lua). 버전이 바뀌면 문구를 다시 대조한다.
const STALLED_LIMIT_FAILED_REASON = 'job stalled more than allowable limit';

// 모든 consumer 가 extends WorkerHost 대신 이 클래스를 상속해 worker 이벤트를 서버 로그에 남긴다.
// @nestjs/bullmq 는 consumer 인스턴스의 prototype chain 전체에서 @OnWorkerEvent 를 찾으므로
// (MetadataScanner.getAllMethodNames) 여기 한 곳에만 달면 상속한 모든 worker 에 걸린다.
//
// stalled: lock 이 만료된 job 을 BullMQ 가 회수해 다시 돌릴 때 난다. 리스너가 없던 동안은 회수돼
// 재실행돼도 로그에 아무것도 남지 않아, 2026-10-07 스윕 이중 리뷰를 원장 시각과 lock 만료 시각을
// 맞춰 추리해야 했다. 이벤트는 jobId 만 주므로 job.name 은 다시 조회한다.
// error: worker 자체 오류(Redis 연결·lock 갱신 실패 등).
// failed: job 처리 실패는 각 consumer 가 catch 에서 이미 남기므로, consumer 를 거치지 않는 실패만 남긴다 —
// stalled 가 maxStalledCount 를 넘긴 job 은 다음에 집힐 때 process 를 부르지 않고 바로 failed 가 된다
// (BullMQ 5.73.1 moveStalledJobsToWait lua 가 사유를 기록 → Worker.getUnrecoverableErrorMessage).
// repeat 로 등록한 cron job 은 lua 가 이 처리에서 제외하므로 해당하는 것은 일회성 job(webhook·crawler·notification)이다.
//
// 메서드 이름은 하위 consumer 와 겹치지 않게 둔다 — 같은 이름을 정의하면 이 핸들러를 가린다.
export abstract class ObservedWorkerHost extends WorkerHost {
  private readonly workerEventLogger = new Logger('WorkerEvent');

  @OnWorkerEvent('stalled')
  async logWorkerStalled(jobId: string): Promise<void> {
    const queueName = this.worker.name;
    let jobName = '(조회 실패)';
    try {
      const job = await Job.fromId(this.worker, jobId);
      jobName = job?.name ?? '(삭제됨)';
    } catch {
      // 이름 조회 실패가 stalled 기록 자체를 막지 않게 한다.
    }
    this.workerEventLogger.warn(
      `stalled 회수 — queue=${queueName} job.name=${jobName} job.id=${jobId}`,
    );
  }

  @OnWorkerEvent('failed')
  logWorkerStalledLimitFailed(job: Job | undefined, error: Error): void {
    if (error.message !== STALLED_LIMIT_FAILED_REASON) {
      return;
    }
    this.workerEventLogger.error(
      `stalled 한도 초과로 실패 — queue=${this.worker.name} job.name=${job?.name ?? '(삭제됨)'} job.id=${job?.id ?? '(알 수 없음)'}`,
    );
  }

  @OnWorkerEvent('error')
  logWorkerError(error: Error): void {
    this.workerEventLogger.error(
      `worker 오류 — queue=${this.worker.name}: ${error.message}`,
      error.stack,
    );
  }
}
