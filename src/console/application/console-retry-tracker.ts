import { Injectable } from '@nestjs/common';

/**
 * 콘솔에서 재시도를 접수해 지금 돌고 있는 원본 run id.
 *
 * 쓰기(`ConsoleWriteService`)가 잠그고, 브리핑이 대상마다 `retrying` 으로 실어 앱이 버튼 상태를
 * 서버 기준으로 맞춘다. 앱이 혼자 잠금을 들고 있으면 새 실행이 생기기도 전에 실패한 재시도에서
 * 원본이 브리핑에 그대로 남아 버튼이 「재시도 중」으로 굳는다.
 *
 * ponytail: 프로세스 메모리라 재시작하면 잊는다. 재시작 중 겹칠 일이 생기면 원장의 자식 run 으로 판정.
 */
@Injectable()
export class ConsoleRetryTracker {
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
