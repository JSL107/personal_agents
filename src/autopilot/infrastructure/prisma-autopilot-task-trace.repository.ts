import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  AutopilotTaskTraceInput,
  AutopilotTaskTracePort,
} from '../domain/port/autopilot-task-trace.port';

@Injectable()
export class PrismaAutopilotTaskTraceRepository implements AutopilotTaskTracePort {
  private readonly logger = new Logger(PrismaAutopilotTaskTraceRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  // best-effort — 이 기록이 실패해도 호출한 task 자체는 원래 결과를 그대로 반환해야 한다.
  // 관측 추가가 새 실패 경로를 만들면 "동작을 바꾸지 않는다" 는 전제가 깨진다.
  async record(input: AutopilotTaskTraceInput): Promise<void> {
    try {
      await this.prisma.autopilotTaskTrace.create({
        data: {
          taskId: input.taskId,
          firedAtKst: input.firedAtKst,
          gateEnabled: input.gateEnabled,
          candidateCount: input.candidateCount,
          llmCalled: input.llmCalled,
          detail: input.detail,
        },
      });
    } catch (error) {
      this.logger.warn(
        `AutopilotTaskTrace 기록 실패(task=${input.taskId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
