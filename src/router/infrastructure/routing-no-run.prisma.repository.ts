import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  RoutingNoRunInput,
  RoutingNoRunPort,
} from '../domain/port/routing-no-run.port';

@Injectable()
export class RoutingNoRunPrismaRepository implements RoutingNoRunPort {
  private readonly logger = new Logger(RoutingNoRunPrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  // 멘션 단위라 빈도가 낮아(하루 수 건) 실패 경고를 억제하지 않는다 — model_call 과 다르다.
  async record(input: RoutingNoRunInput): Promise<void> {
    try {
      await this.prisma.routingNoRun.create({ data: input });
    } catch (error) {
      this.logger.warn(
        `routing_no_run 기록 실패(routedTo=${input.routedTo}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
