import { Injectable } from '@nestjs/common';
import { GoalQuestion, Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  AttachGoalQuestionPreviewInput,
  CloseGoalQuestionInput,
  CreateGoalQuestionInput,
  FindOpenGoalQuestionInput,
  GoalQuestionRecord,
  GoalQuestionRepositoryPort,
  MarkGoalQuestionCriterionAskedInput,
} from '../domain/port/goal-question.repository.port';

const toRecord = (row: GoalQuestion): GoalQuestionRecord => ({
  id: row.id,
  slackUserId: row.slackUserId,
  expiresAt: row.expiresAt,
  previewId: row.previewId,
  criterionAskedAt: row.criterionAskedAt,
  pendingDraft: row.pendingDraft,
  closedAt: row.closedAt,
  closeReason: row.closeReason,
  createdAt: row.createdAt,
});

@Injectable()
export class GoalQuestionPrismaRepository implements GoalQuestionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateGoalQuestionInput): Promise<GoalQuestionRecord> {
    const row = await this.prisma.goalQuestion.create({ data: input });
    return toRecord(row);
  }

  async findOpen({
    slackUserId,
    now,
  }: FindOpenGoalQuestionInput): Promise<GoalQuestionRecord | null> {
    const row = await this.prisma.goalQuestion.findFirst({
      where: { slackUserId, closedAt: null, expiresAt: { gt: now } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? toRecord(row) : null;
  }

  async attachPreview({
    id,
    previewId,
  }: AttachGoalQuestionPreviewInput): Promise<void> {
    await this.prisma.goalQuestion.updateMany({
      where: { id, closedAt: null },
      data: { previewId, pendingDraft: Prisma.DbNull },
    });
  }

  async markCriterionAsked({
    id,
    at,
    pendingDraft,
  }: MarkGoalQuestionCriterionAskedInput): Promise<void> {
    await this.prisma.goalQuestion.updateMany({
      where: { id, closedAt: null },
      data: {
        criterionAskedAt: at,
        pendingDraft: pendingDraft as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async close({ id, reason, at }: CloseGoalQuestionInput): Promise<void> {
    await this.prisma.goalQuestion.updateMany({
      where: { id, closedAt: null },
      data: { closedAt: at, closeReason: reason },
    });
  }
}
