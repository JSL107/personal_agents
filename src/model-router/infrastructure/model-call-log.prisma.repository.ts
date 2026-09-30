import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ModelCallLogInput,
  ModelCallLogPort,
} from '../domain/port/model-call-log.port';

// 기록 실패 경고를 한 번 낸 뒤 이 시간 동안은 세기만 한다. 테이블이 아직 없거나(db:push 전 배포)
// DB 가 내려가면 모든 모델 호출이 실패하므로, 억제가 없으면 로그가 호출 수만큼 쏟아진다.
const FAILURE_LOG_SUPPRESS_MS = 10 * 60 * 1000;

@Injectable()
export class ModelCallLogPrismaRepository implements ModelCallLogPort {
  private readonly logger = new Logger(ModelCallLogPrismaRepository.name);
  private suppressUntilMs = 0;
  private suppressedCount = 0;

  constructor(private readonly prisma: PrismaService) {}

  async record(input: ModelCallLogInput): Promise<void> {
    try {
      await this.prisma.modelCall.create({ data: input });
    } catch (error) {
      this.warnThrottled(error);
    }
  }

  private warnThrottled(error: unknown): void {
    const now = Date.now();
    if (now < this.suppressUntilMs) {
      this.suppressedCount += 1;
      return;
    }
    const suppressed =
      this.suppressedCount > 0
        ? ` (직전 ${this.suppressedCount}건 경고 억제)`
        : '';
    this.logger.warn(
      `model_call 기록 실패 — ${FAILURE_LOG_SUPPRESS_MS / 60_000}분간 추가 경고를 억제한다${suppressed}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    this.suppressUntilMs = now + FAILURE_LOG_SUPPRESS_MS;
    this.suppressedCount = 0;
  }
}
