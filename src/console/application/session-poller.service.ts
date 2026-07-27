import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { LocalSessionService } from '../../local-sessions/application/local-session.service';
import { ConsoleSession } from '../domain/console.type';
import { ConsoleEventBus } from './console-event-bus.service';
import { toConsoleSession } from './console-mappers';
import { diffSessions } from './session-diff';

// 로컬 세션은 파일 변화라서 in-process 이벤트가 없다 → 주기 폴링으로 diff 해 SSE 로 흘린다.
@Injectable()
export class SessionPollerService implements OnModuleInit, OnModuleDestroy {
  private static readonly POLL_MS = 3_000;
  private readonly logger = new Logger(SessionPollerService.name);
  private previous: ConsoleSession[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly localSessions: LocalSessionService,
    private readonly bus: ConsoleEventBus,
  ) {}

  onModuleInit(): void {
    this.prime();
    this.timer = setInterval(() => {
      this.pollOnce();
    }, SessionPollerService.POLL_MS);
    // 이 타이머가 프로세스 종료를 막지 않도록.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // 첫 상태는 스냅샷이 이미 담으므로 발행 없이 baseline 만 세운다.
  prime(): void {
    this.previous = this.snapshot();
  }

  pollOnce(): void {
    try {
      const next = this.snapshot();
      for (const event of diffSessions(this.previous, next)) {
        this.bus.publish(event);
      }
      this.previous = next;
    } catch (error) {
      this.logger.warn(`세션 폴링 실패 — 이번 tick 건너뜀: ${String(error)}`);
    }
  }

  private snapshot(): ConsoleSession[] {
    return this.localSessions.list().map(toConsoleSession);
  }
}
