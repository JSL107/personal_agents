import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  CloseProductGoalInput,
  CreateProductGoalInput,
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

  async create(input: CreateProductGoalInput): Promise<ProductGoalRecord> {
    const created = await this.prisma.productGoal.create({ data: input });
    return toRecord(created);
  }

  async close(input: CloseProductGoalInput): Promise<boolean> {
    const updated = await this.prisma.productGoal.updateMany({
      where: { id: input.id, slackUserId: input.slackUserId, closedAt: null },
      data: { closedAt: input.closedAt },
    });
    return updated.count > 0;
  }
}
