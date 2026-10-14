import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { plainDateToUtcDate } from '../../schedule/domain/parse-due-date';
import {
  CreateIdeaTriageInput,
  IdeaTriageRecord,
  IdeaTriageRepositoryPort,
} from '../domain/port/idea-triage.repository.port';

type IdeaTriageRow = Prisma.IdeaTriageGetPayload<Record<string, never>>;

const toRecord = (row: IdeaTriageRow): IdeaTriageRecord => ({
  id: row.id,
  channelId: row.channelId,
  messageTs: row.messageTs,
  authorSlackUserId: row.authorSlackUserId,
  ideaText: row.ideaText,
  verdict: row.verdict,
  reason: row.reason,
  counterpoint: row.counterpoint,
  scheduleTitle: row.scheduleTitle,
  effort: row.effort,
  proposedDate: {
    year: row.proposedDate.getUTCFullYear(),
    month: row.proposedDate.getUTCMonth() + 1,
    day: row.proposedDate.getUTCDate(),
  },
  status: row.status,
  replyTs: row.replyTs,
  previewId: row.previewId,
  scheduleItemId: row.scheduleItemId,
  agentRunId: row.agentRunId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

@Injectable()
export class IdeaTriagePrismaRepository implements IdeaTriageRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findExisting(
    channelId: string,
    messageTsList: string[],
  ): Promise<string[]> {
    if (messageTsList.length === 0) {
      return [];
    }
    const rows = await this.prisma.ideaTriage.findMany({
      where: { channelId, messageTs: { in: messageTsList } },
      select: { messageTs: true },
    });
    return rows.map((row) => row.messageTs);
  }

  async create(input: CreateIdeaTriageInput): Promise<IdeaTriageRecord | null> {
    try {
      const row = await this.prisma.ideaTriage.create({
        data: {
          ...input,
          proposedDate: plainDateToUtcDate(input.proposedDate),
          status: 'JUDGED',
        },
      });
      return toRecord(row);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  async markPosted(
    id: number,
    replyTs: string,
    previewId?: string,
  ): Promise<void> {
    await this.prisma.ideaTriage.update({
      where: { id },
      data: { status: 'POSTED', replyTs, previewId: previewId ?? null },
    });
  }

  async markReplySent(id: number, replyTs: string): Promise<void> {
    await this.prisma.ideaTriage.update({
      where: { id },
      data: { replyTs },
    });
  }

  async markPreviewCreated(id: number, previewId: string): Promise<void> {
    await this.prisma.ideaTriage.update({
      where: { id },
      data: { previewId },
    });
  }

  async findUnposted(channelId: string): Promise<IdeaTriageRecord[]> {
    const rows = await this.prisma.ideaTriage.findMany({
      where: { channelId, status: 'JUDGED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async markScheduled(id: number, scheduleItemId: number): Promise<void> {
    await this.prisma.ideaTriage.update({
      where: { id },
      data: { status: 'SCHEDULED', scheduleItemId },
    });
  }

  async findById(id: number): Promise<IdeaTriageRecord | null> {
    const row = await this.prisma.ideaTriage.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }
}
