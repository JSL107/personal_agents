import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

// heartbeat 주기. 이 간격으로 lastBeatAt 을 갱신한다 — 절전 중엔 setInterval 이 멈춰 갱신이 끊긴다.
const WAKE_HEARTBEAT_INTERVAL_MS = 30_000;
// tick 이 이 임계보다 오래 멈췄으면 절전/일시정지에서 깨어난 것으로 본다.
// (heartbeat 30s + 여유 — SlackService 소켓 워치독의 30s+90s 임계와 동일한 120s.)
const WAKE_DRIFT_THRESHOLD_MS = 120_000;
// 깨어난 뒤 백엔드 준비 확인 probe 폴링 간격 / 최대 대기.
// 최대 대기는 worker lockDuration 예산(common/queue/worker-options.constant.ts)도 참조하므로 export 한다.
const WAKE_PROBE_INTERVAL_MS = 20_000;
export const WAKE_PROBE_MAX_WAIT_MS = 180_000;

export interface WakeSettleResult {
  // 절전 감지로 실제 대기(폴링)를 했는지.
  waited: boolean;
  // 백엔드가 준비됐다고 확인됐는지(false = 타임아웃으로 미확인, 그래도 실행은 진행).
  ready: boolean;
  // probe 시도 횟수.
  attempts: number;
}

// heartbeat tick 이 임계보다 오래 멈췄으면(절전으로 setInterval 이 안 돌면) "방금 깸" 으로 판정하는 순수 함수.
export const hasWoken = (elapsedMs: number, thresholdMs: number): boolean =>
  elapsedMs > thresholdMs;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// 절전/일시정지에서 깨어난 직후를 감지하고, 그 순간 실행되는 작업이 백엔드 준비 전에
// 나가 실패하지 않도록 "준비될 때까지 대기" 를 제공하는 공용 가드.
//
// 자체 heartbeat(setInterval)로 절전을 감지하므로, 소비자(autopilot consumer 등)의 실행
// 시점과 SlackService 소켓 워치독 tick 사이의 순서 경합에 영향받지 않는다. codex 등 특정
// 백엔드를 알지 못하며, probe 함수를 주입받아 폴링 메커니즘만 담당한다.
@Injectable()
export class SystemWakeGuard implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemWakeGuard.name);
  private lastBeatAt = Date.now();
  private heartbeat?: ReturnType<typeof setInterval>;

  onModuleInit(): void {
    this.lastBeatAt = this.now();
    this.heartbeat = setInterval(() => {
      this.lastBeatAt = this.now();
    }, WAKE_HEARTBEAT_INTERVAL_MS);
    // heartbeat 가 프로세스 종료를 막지 않게 한다(존재 시 — 일부 환경엔 unref 없음).
    this.heartbeat.unref?.();
  }

  onModuleDestroy(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  // heartbeat tick 이 임계보다 오래 멈췄으면(절전 등) true.
  justWoke(): boolean {
    return hasWoken(this.now() - this.lastBeatAt, WAKE_DRIFT_THRESHOLD_MS);
  }

  // 방금 절전에서 깼으면, probe 가 성공(백엔드 준비)할 때까지 bounded 폴링 후 반환한다.
  // - 평상시(절전 아님): 대기 없이 즉시 준비된 것으로 반환.
  // - 타임아웃: 미준비(ready=false) 로 반환하되 호출자는 그대로 실행 — 상위(BullMQ) 재시도가 안전망.
  async waitUntilReady(
    probe: () => Promise<boolean>,
    opts: { intervalMs?: number; maxWaitMs?: number } = {},
  ): Promise<WakeSettleResult> {
    if (!this.justWoke()) {
      return { waited: false, ready: true, attempts: 0 };
    }
    const intervalMs = opts.intervalMs ?? WAKE_PROBE_INTERVAL_MS;
    const maxWaitMs = opts.maxWaitMs ?? WAKE_PROBE_MAX_WAIT_MS;
    this.logger.warn(
      `절전/일시정지 감지 — 백엔드 준비 확인 후 실행 (최대 ${Math.round(
        maxWaitMs / 1000,
      )}s 폴링)`,
    );
    const deadline = this.now() + maxWaitMs;
    let attempts = 0;
    while (this.now() < deadline) {
      attempts += 1;
      const ready = await this.safeProbe(probe);
      // probe / 대기에 쓴 시간이 다음 작업의 절전 오판(연쇄 지연)을 만들지 않도록 heartbeat 를 최신화.
      this.lastBeatAt = this.now();
      if (ready) {
        this.logger.log(`백엔드 준비 확인 — 실행 진행 (probe ${attempts}회)`);
        return { waited: true, ready: true, attempts };
      }
      await delay(intervalMs);
      this.lastBeatAt = this.now();
    }
    this.logger.warn(
      `백엔드 준비 확인 타임아웃 — 그대로 실행 진행 (probe ${attempts}회 실패, 상위 재시도에 위임)`,
    );
    return { waited: true, ready: false, attempts };
  }

  private async safeProbe(probe: () => Promise<boolean>): Promise<boolean> {
    try {
      return await probe();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message.slice(0, 200) : String(error);
      this.logger.warn(`준비 probe 예외 — 미준비로 처리: ${message}`);
      return false;
    }
  }

  // 테스트에서 시간을 제어할 수 있도록 분리한 시각 소스.
  protected now(): number {
    return Date.now();
  }
}
