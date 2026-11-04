import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  DailyTodoListRecord,
  DailyTodoListStatus,
  FindDailyTodoInput,
  ReplaceDailyTodoInput,
  WorkTurn,
} from '../domain/daily-todo.type';
import { DailyTodoRepositoryPort } from '../domain/port/daily-todo.repository.port';

@Injectable()
export class DailyTodoPrismaRepository implements DailyTodoRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async replaceForDate(input: ReplaceDailyTodoInput): Promise<void> {
    await this.prisma.$transaction(async (client) => {
      const list = await client.dailyTodoList.upsert({
        where: {
          slackUserId_kstDate: {
            slackUserId: input.slackUserId,
            kstDate: input.kstDate,
          },
        },
        create: {
          slackUserId: input.slackUserId,
          kstDate: input.kstDate,
          status: input.status,
        },
        update: { status: input.status },
      });
      await client.dailyTodoEntry.deleteMany({ where: { listId: list.id } });
      if (input.entries.length > 0) {
        await client.dailyTodoEntry.createMany({
          data: input.entries.map((entry) => ({ ...entry, listId: list.id })),
        });
      }
    });
  }

  async findForDate(
    input: FindDailyTodoInput,
  ): Promise<DailyTodoListRecord | null> {
    const list = await this.prisma.dailyTodoList.findUnique({
      where: {
        slackUserId_kstDate: {
          slackUserId: input.slackUserId,
          kstDate: input.kstDate,
        },
      },
      include: { entries: { orderBy: { position: 'asc' } } },
    });
    if (!list) {
      return null;
    }
    return {
      status: list.status as DailyTodoListStatus,
      entries: list.entries.map((entry) => ({
        scheduleItemId: entry.scheduleItemId,
        turn: entry.turn as WorkTurn,
        observed: entry.observed,
        position: entry.position,
      })),
    };
  }
}
