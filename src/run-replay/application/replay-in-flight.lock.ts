import { Injectable } from '@nestjs/common';

/**
 * 지금 재실행 중인 원본 run id. Slack `/retry-run` 과 콘솔 재시도 버튼이 같은 잠금을 쓴다 —
 * 진입점마다 따로 잠그면 두 곳에서 동시에 누른 같은 run 이 두 번 돌아 게시 리뷰·발행 카드가 두 벌 나간다.
 *
 * 콘솔 브리핑도 이 값을 대상마다 `retrying` 으로 실어 앱 버튼 상태를 서버 기준으로 맞춘다.
 *
 * ponytail: 프로세스 메모리 잠금이다. 이 앱은 Slack·콘솔을 한 프로세스에서 받으므로 충분하다.
 * 재시작하면 잊고, 다중 인스턴스가 되면 DB 기반(원장의 자식 run 또는 advisory lock)으로 바꾼다.
 */
@Injectable()
export class ReplayInFlightLock {
  private readonly runIds = new Set<number>();

  /** 비어 있으면 잠그고 true. 이미 돌고 있으면 false. */
  tryAcquire(runId: number): boolean {
    if (this.runIds.has(runId)) {
      return false;
    }
    this.runIds.add(runId);
    return true;
  }

  release(runId: number): void {
    this.runIds.delete(runId);
  }

  isRetrying(runId: number): boolean {
    return this.runIds.has(runId);
  }
}
