import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  ActiveGoalGuard,
  CloseProductGoalInput,
  CreateProductGoalInput,
  CreateProductGoalResult,
  ProductGoalRepositoryPort,
} from '../domain/port/product-goal.repository.port';
import { ProductGoalRecord } from '../domain/product-goal';

interface ProductGoalRow {
  id: number;
  slackUserId: string;
  title: string;
  successCriterion: string;
  keywords: string[];
  dueDate: Date | null;
  closedAt: Date | null;
  createdAt: Date;
}

const toRecord = (row: ProductGoalRow): ProductGoalRecord => ({
  id: row.id,
  slackUserId: row.slackUserId,
  title: row.title,
  successCriterion: row.successCriterion,
  keywords: row.keywords,
  dueDate: row.dueDate,
  closedAt: row.closedAt,
  createdAt: row.createdAt,
});

// Prisma 가 직렬화 격리 충돌·교착을 돌려주는 코드.
const SERIALIZATION_FAILURE_CODE = 'P2034';

const isSerializationFailure = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === SERIALIZATION_FAILURE_CODE;

@Injectable()
export class ProductGoalPrismaRepository implements ProductGoalRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(slackUserId: string): Promise<ProductGoalRecord[]> {
    const rows = await this.prisma.productGoal.findMany({
      where: { slackUserId, closedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRecord);
  }

  async createGuarded(
    input: CreateProductGoalInput,
    guard: ActiveGoalGuard,
  ): Promise<CreateProductGoalResult> {
    // 동시 승인으로 직렬화가 깨진 쪽은 한 번 다시 돈다. 재시도는 먼저 끝난 쪽의 행을 보므로
    // 상한을 넘었으면 원시 DB 오류 대신 "상한 도달" 거절로 끝난다.
    try {
      return await this.createGuardedOnce(input, guard);
    } catch (error: unknown) {
      if (!isSerializationFailure(error)) {
        throw error;
      }
      return await this.createGuardedOnce(input, guard);
    }
  }

  private async createGuardedOnce(
    input: CreateProductGoalInput,
    guard: ActiveGoalGuard,
  ): Promise<CreateProductGoalResult> {
    return await this.prisma.$transaction(
      async (transaction) => {
        const rows = await transaction.productGoal.findMany({
          where: { slackUserId: input.slackUserId, closedAt: null },
          orderBy: { createdAt: 'asc' },
        });
        const activeGoals = rows.map(toRecord);
        const problem = guard(activeGoals);
        if (problem !== null) {
          return { problem, activeGoals };
        }
        const created = await transaction.productGoal.create({ data: input });
        return { created: toRecord(created) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async close(input: CloseProductGoalInput): Promise<boolean> {
    const updated = await this.prisma.productGoal.updateMany({
      where: { id: input.id, slackUserId: input.slackUserId, closedAt: null },
      data: { closedAt: input.closedAt },
    });
    return updated.count > 0;
  }
}
