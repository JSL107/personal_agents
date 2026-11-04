import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleCollectionStateRepositoryPort } from '../domain/port/schedule-collection-state.repository.port';
import { ScheduleSource } from '../domain/schedule.type';

@Injectable()
export class ScheduleCollectionStatePrismaRepository implements ScheduleCollectionStateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async get(source: ScheduleSource): Promise<Date | null> {
    const found = await this.prisma.scheduleCollectionState.findUnique({
      where: { source },
    });
    return found?.lastSucceededAt ?? null;
  }

  async markSucceeded(source: ScheduleSource, at: Date): Promise<void> {
    await this.prisma.scheduleCollectionState.upsert({
      where: { source },
      create: { source, lastSucceededAt: at },
      update: { lastSucceededAt: at },
    });
  }
}
