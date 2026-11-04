import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  FindByDateRangeInput,
  SaveScheduleInput,
  ScheduleRepositoryPort,
  UpdateStatusInput,
} from '../domain/port/schedule.repository.port';
import { ScheduleException } from '../domain/schedule.exception';
import {
  AddEventInput,
  AddFollowUpInput,
  AddNoteInput,
  CollectedScheduleInput,
  CountActiveCandidatesInput,
  CountPendingFollowUpsInput,
  DueClaimInput,
  FindBySourceInput,
  FindBySourceKeyInput,
  FindCompletedBetweenInput,
  FindScheduleDetailInput,
  FindUnfinishedInput,
  MarkFollowUpNotifiedInput,
  MarkRemindedInput,
  PersistScheduleFieldsInput,
  RecordedEventTransition,
  RecordEventAndTransitionInput,
  SaveFollowUpDraftInput,
  ScheduleActor,
  ScheduleDetail,
  ScheduleEventRecord,
  ScheduleFollowUpRecord,
  TransitionInput,
  UpdateFollowUpInput,
} from '../domain/schedule.repository.type';
import {
  DatedScheduleItemRecord,
  FollowUpTrigger,
  ScheduleEventKind,
  ScheduleItemRecord,
  ScheduleSource,
  ScheduleStatus,
} from '../domain/schedule.type';
import { ScheduleErrorCode } from '../domain/schedule-error-code.enum';
import { TransitionInTransactionInput } from './schedule.prisma.repository.type';

const validateCompletedAt = (
  to: ScheduleStatus | null,
  completedAt: Date | undefined,
  now: Date,
): void => {
  if (
    completedAt !== undefined &&
    (to !== ScheduleStatus.DONE ||
      !Number.isFinite(completedAt.getTime()) ||
      completedAt > now)
  ) {
    throw new ScheduleException({
      code: ScheduleErrorCode.INVALID_COMPLETED_AT,
      message: '유효하지 않은 완료 시각입니다.',
    });
  }
};

interface ScheduleItemRow {
  id: number;
  createdAt: Date;
  slackUserId: string;
  title: string;
  dueDate: Date | null;
  dueTime: string | null;
  linkUrl: string | null;
  memo: string | null;
  status: string;
  completedAt: Date | null;
  isHoliday: boolean;
  startDate?: Date | null;
  startedAt?: Date | null;
  remindAt?: Date | null;
  remindedAt?: Date | null;
  source?: string;
  sourceKey?: string | null;
  sourceUrl?: string | null;
  candidateExpiresAt?: Date | null;
  deliveryClaimedAt?: Date | null;
}

interface DueDateFilter {
  gte?: Date;
  lte: Date;
}

// `from` 이 없으면 `gte` 를 **아예 싣지 않는다**. Prisma 가 `undefined` 를 알아서 빼 주기는
// 하지만 그 동작에 기대면 읽는 사람이 "하한 없음" 이 의도인지 실수인지 구분할 수 없고,
// 에폭(`new Date(0)`) 같은 대체 하한을 쓰면 그 숫자의 뜻을 아무도 알 수 없다.
const buildDueDateFilter = (input: FindByDateRangeInput): DueDateFilter => {
  if (input.from === undefined) {
    return { lte: input.to };
  }
  return { gte: input.from, lte: input.to };
};

const toRecord = (row: ScheduleItemRow): ScheduleItemRecord => {
  return {
    id: row.id,
    createdAt: row.createdAt,
    slackUserId: row.slackUserId,
    title: row.title,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    linkUrl: row.linkUrl,
    memo: row.memo,
    status: row.status as ScheduleStatus,
    completedAt: row.completedAt,
    isHoliday: row.isHoliday,
    startDate: row.startDate ?? null,
    startedAt: row.startedAt ?? null,
    remindAt: row.remindAt ?? null,
    remindedAt: row.remindedAt ?? null,
    source: (row.source ?? ScheduleSource.MANUAL) as ScheduleSource,
    sourceKey: row.sourceKey ?? null,
    sourceUrl: row.sourceUrl ?? null,
    candidateExpiresAt: row.candidateExpiresAt ?? null,
    deliveryClaimedAt: row.deliveryClaimedAt ?? null,
  };
};

const toFollowUp = (row: {
  id: number;
  scheduleItemId: number;
  recipient: string;
  topic: string;
  trigger: string;
  triggerAt: Date | null;
  draft: string | null;
  notifiedAt: Date | null;
  sentAt: Date | null;
  deliveryClaimedAt: Date | null;
}): ScheduleFollowUpRecord => ({
  ...row,
  trigger: row.trigger as FollowUpTrigger,
});

const toEvent = (row: {
  id: number;
  scheduleItemId: number;
  kind: string;
  payload: unknown;
  dedupeKey: string | null;
  occurredAt: Date;
}): ScheduleEventRecord => ({ ...row, kind: row.kind as ScheduleEventKind });

const isUniqueViolation = (error: unknown): boolean => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
};

@Injectable()
export class SchedulePrismaRepository implements ScheduleRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: SaveScheduleInput): Promise<ScheduleItemRecord> {
    const created = await this.prisma.scheduleItem.create({
      data: {
        slackUserId: input.slackUserId,
        title: input.title,
        dueDate: input.dueDate,
        dueTime: input.dueTime ?? null,
        startDate: input.startDate ?? null,
        remindAt: input.remindAt ?? null,
        memo: input.memo ?? null,
        status: ScheduleStatus.OPEN,
        isHoliday: input.isHoliday ?? false,
        events: {
          create: {
            kind: ScheduleEventKind.CREATED,
            payload: { source: ScheduleSource.MANUAL },
            occurredAt: new Date(),
          },
        },
      },
    });
    return toRecord(created);
  }

  async findByDateRange(
    input: FindByDateRangeInput,
  ): Promise<DatedScheduleItemRecord[]> {
    // 마감일 오름차순 — 기한이 지난 것이 먼저 온다. 브리핑 한 줄(`formatUpcomingLine`)도
    // 콘솔 목록도 받은 순서를 그대로 쓰므로 "지난 것이 앞" 은 여기 한 곳이 정한다.
    const rows = await this.prisma.scheduleItem.findMany({
      where: {
        slackUserId: input.slackUserId,
        dueDate: buildDueDateFilter(input),
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    return rows
      .filter((row) => row.dueDate !== null)
      .map((row) => toRecord(row) as DatedScheduleItemRecord);
  }

  async findTrackingMonth(
    input: Required<FindByDateRangeInput>,
  ): Promise<ScheduleItemRecord[]> {
    const range = { gte: input.from, lte: input.to };
    const rows = await this.prisma.scheduleItem.findMany({
      where: {
        slackUserId: input.slackUserId,
        OR: [{ dueDate: range }, { startDate: range }],
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async findUndated(slackUserId: string): Promise<ScheduleItemRecord[]> {
    const rows = await this.prisma.scheduleItem.findMany({
      where: {
        slackUserId,
        dueDate: null,
        status: {
          in: [
            ScheduleStatus.OPEN,
            ScheduleStatus.IN_PROGRESS,
            ScheduleStatus.CANDIDATE,
          ],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toRecord);
  }

  async findCompletedBetween(
    input: FindCompletedBetweenInput,
  ): Promise<ScheduleItemRecord[]> {
    const rows = await this.prisma.scheduleItem.findMany({
      where: {
        slackUserId: input.slackUserId,
        status: ScheduleStatus.DONE,
        completedAt: { gte: input.from, lt: input.to },
      },
    });
    return rows.map(toRecord);
  }

  async findUnfinished(
    input: FindUnfinishedInput,
  ): Promise<ScheduleItemRecord[]> {
    const rows = await this.prisma.scheduleItem.findMany({
      where: {
        slackUserId: input.slackUserId,
        status: {
          in: [
            ScheduleStatus.OPEN,
            ScheduleStatus.IN_PROGRESS,
            ScheduleStatus.CANDIDATE,
          ],
        },
      },
      orderBy: [{ id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async findAllByOwner(slackUserId: string): Promise<ScheduleItemRecord[]> {
    const rows = await this.prisma.scheduleItem.findMany({
      where: { slackUserId },
      orderBy: [{ id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async findBySource(input: FindBySourceInput): Promise<ScheduleItemRecord[]> {
    const rows = await this.prisma.scheduleItem.findMany({
      where: { slackUserId: input.slackUserId, source: input.source },
      orderBy: [{ id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async findById(id: number): Promise<ScheduleItemRecord | null> {
    const found = await this.prisma.scheduleItem.findUnique({ where: { id } });
    if (!found) {
      return null;
    }
    return toRecord(found);
  }

  async findBySourceKey(
    input: FindBySourceKeyInput,
  ): Promise<ScheduleItemRecord | null> {
    const found = await this.prisma.scheduleItem.findUnique({
      where: {
        slackUserId_source_sourceKey: {
          slackUserId: input.slackUserId,
          source: input.source,
          sourceKey: input.sourceKey,
        },
      },
    });
    return found ? toRecord(found) : null;
  }

  async updateStatus(input: UpdateStatusInput): Promise<ScheduleItemRecord> {
    const updated = await this.prisma.scheduleItem.update({
      where: { id: input.id },
      data: { status: input.status, completedAt: input.completedAt },
    });
    return toRecord(updated);
  }

  async transition(input: TransitionInput): Promise<ScheduleItemRecord | null> {
    validateCompletedAt(input.to, input.completedAt, input.now);
    return await this.prisma.$transaction(async (client) =>
      this.transitionInTransaction({ client, input }),
    );
  }

  private async transitionInTransaction({
    client,
    input,
  }: TransitionInTransactionInput): Promise<ScheduleItemRecord | null> {
    const before = await client.scheduleItem.findUnique({
      where: { id: input.id },
    });
    if (!before || before.slackUserId !== input.slackUserId) {
      return null;
    }
    const data: Prisma.ScheduleItemUpdateManyMutationInput = {
      status: input.to,
      completedAt:
        input.to === ScheduleStatus.DONE
          ? (input.completedAt ?? input.now)
          : null,
      ...input.patch,
    };
    if (
      input.patch?.remindAt !== undefined &&
      input.patch.remindAt?.getTime() !== before.remindAt?.getTime()
    ) {
      data.remindedAt = null;
      data.deliveryClaimedAt = null;
    }
    if (input.to === ScheduleStatus.IN_PROGRESS && before.startedAt === null) {
      data.startedAt = input.now;
    }
    const updated = await client.scheduleItem.updateMany({
      where: {
        id: input.id,
        slackUserId: input.slackUserId,
        status: input.from,
        ...input.expected,
      },
      data,
    });
    if (updated.count === 0) {
      return null;
    }
    if (
      input.to === ScheduleStatus.DONE ||
      input.from === ScheduleStatus.DONE
    ) {
      await client.scheduleFollowUp.updateMany({
        where: {
          scheduleItemId: input.id,
          trigger: FollowUpTrigger.ON_DONE,
          notifiedAt: null,
        },
        data: {
          triggerAt: input.to === ScheduleStatus.DONE ? input.now : null,
        },
      });
    }
    await client.scheduleEvent.create({
      data: {
        scheduleItemId: input.id,
        kind: ScheduleEventKind.STATUS_CHANGED,
        payload: { from: input.from, to: input.to, actor: input.actor },
        occurredAt: input.now,
      },
    });
    const found = await client.scheduleItem.findUnique({
      where: { id: input.id },
    });
    return found ? toRecord(found) : null;
  }

  async createCollected(
    input: CollectedScheduleInput,
  ): Promise<ScheduleItemRecord | 'DUPLICATE'> {
    try {
      const created = await this.prisma.scheduleItem.create({
        data: {
          slackUserId: input.slackUserId,
          title: input.title,
          dueDate: input.dueDate,
          startDate: input.startDate ?? null,
          memo: input.memo ?? null,
          source: input.source,
          sourceKey: input.sourceKey,
          sourceUrl: input.sourceUrl,
          status: input.status,
          startedAt:
            input.startedAt ??
            (input.status === ScheduleStatus.IN_PROGRESS ? new Date() : null),
          candidateExpiresAt: input.candidateExpiresAt ?? null,
          events: {
            create: {
              kind: ScheduleEventKind.CREATED,
              occurredAt: new Date(),
              payload: { source: input.source },
            },
          },
        },
      });
      return toRecord(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return 'DUPLICATE';
      }
      throw error;
    }
  }

  async updateFields(
    input: PersistScheduleFieldsInput,
  ): Promise<ScheduleItemRecord | null> {
    const found = await this.prisma.scheduleItem.findFirst({
      where: { id: input.id, slackUserId: input.slackUserId },
    });
    if (!found) {
      return null;
    }
    const data: Prisma.ScheduleItemUpdateManyMutationInput = { ...input.patch };
    if (
      input.patch.remindAt !== undefined &&
      input.patch.remindAt?.getTime() !== found.remindAt?.getTime()
    ) {
      data.remindedAt = null;
      data.deliveryClaimedAt = null;
    }
    const updated = await this.prisma.scheduleItem.updateMany({
      where: {
        id: input.id,
        slackUserId: input.slackUserId,
        ...input.expected,
      },
      data,
    });
    if (updated.count === 0) {
      return null;
    }
    const current = await this.prisma.scheduleItem.findUnique({
      where: { id: input.id },
    });
    return current ? toRecord(current) : null;
  }

  async countActiveCandidates({
    slackUserId,
    now,
  }: CountActiveCandidatesInput): Promise<number> {
    return this.prisma.scheduleItem.count({
      where: {
        slackUserId,
        status: ScheduleStatus.CANDIDATE,
        source: ScheduleSource.SLACK_MENTION,
        candidateExpiresAt: { gt: now },
      },
    });
  }

  async claimDueReminders(input: DueClaimInput): Promise<ScheduleItemRecord[]> {
    const stale = new Date(input.now.getTime() - 600_000);
    const rows = await this.prisma.scheduleItem.findMany({
      where: {
        slackUserId: input.ownerId,
        status: { in: [ScheduleStatus.OPEN, ScheduleStatus.IN_PROGRESS] },
        remindAt: { lte: input.now },
        remindedAt: null,
      },
      orderBy: [{ remindAt: 'asc' }, { id: 'asc' }],
    });
    const claimed: ScheduleItemRecord[] = [];
    for (const row of rows) {
      const changed = await this.prisma.scheduleItem.updateMany({
        where: {
          id: row.id,
          slackUserId: input.ownerId,
          remindAt: { lte: input.now },
          remindedAt: null,
          status: { in: [ScheduleStatus.OPEN, ScheduleStatus.IN_PROGRESS] },
          OR: [
            { deliveryClaimedAt: null },
            { deliveryClaimedAt: { lt: stale } },
          ],
        },
        data: { deliveryClaimedAt: input.now },
      });
      if (changed.count === 1) {
        claimed.push(toRecord({ ...row, deliveryClaimedAt: input.now }));
      }
    }
    return claimed;
  }

  async claimDueFollowUps(
    input: DueClaimInput,
  ): Promise<ScheduleFollowUpRecord[]> {
    const stale = new Date(input.now.getTime() - 600_000);
    const rows = await this.prisma.scheduleFollowUp.findMany({
      where: {
        scheduleItem: { slackUserId: input.ownerId },
        triggerAt: { lte: input.now },
        notifiedAt: null,
        sentAt: null,
        OR: [
          {
            trigger: FollowUpTrigger.ON_DONE,
            scheduleItem: { status: ScheduleStatus.DONE },
          },
          {
            trigger: FollowUpTrigger.AT_TIME,
            scheduleItem: { status: { not: ScheduleStatus.SKIPPED } },
          },
        ],
      },
      orderBy: [{ triggerAt: 'asc' }, { id: 'asc' }],
      take: input.limit ?? 3,
    });
    const claimed: ScheduleFollowUpRecord[] = [];
    for (const row of rows) {
      const changed = await this.prisma.scheduleFollowUp.updateMany({
        where: {
          id: row.id,
          notifiedAt: null,
          sentAt: null,
          triggerAt: { lte: input.now },
          scheduleItem: { slackUserId: input.ownerId },
          AND: [
            {
              OR: [
                {
                  trigger: FollowUpTrigger.ON_DONE,
                  scheduleItem: { status: ScheduleStatus.DONE },
                },
                {
                  trigger: FollowUpTrigger.AT_TIME,
                  scheduleItem: { status: { not: ScheduleStatus.SKIPPED } },
                },
              ],
            },
          ],
          OR: [
            { deliveryClaimedAt: null },
            { deliveryClaimedAt: { lt: stale } },
          ],
        },
        data: { deliveryClaimedAt: input.now },
      });
      if (changed.count === 1) {
        claimed.push(toFollowUp({ ...row, deliveryClaimedAt: input.now }));
      }
    }
    return claimed;
  }

  async markReminded(input: MarkRemindedInput): Promise<boolean> {
    return await this.prisma.$transaction(async (client) => {
      const found = await client.scheduleItem.findUnique({
        where: { id: input.id },
      });
      if (!found || !found.remindAt) {
        return false;
      }
      const updated = await client.scheduleItem.updateMany({
        where: {
          id: input.id,
          remindedAt: null,
          deliveryClaimedAt: input.claimAt,
          remindAt: input.reminderAt,
        },
        data: { remindedAt: input.now, deliveryClaimedAt: null },
      });
      if (updated.count === 0) {
        return false;
      }
      await client.scheduleEvent.createMany({
        skipDuplicates: true,
        data: [
          {
            scheduleItemId: input.id,
            kind: ScheduleEventKind.REMINDED,
            dedupeKey: String(found.remindAt.getTime()),
            payload: {},
            occurredAt: input.now,
          },
        ],
      });
      return true;
    });
  }

  async saveFollowUpDraft(input: SaveFollowUpDraftInput): Promise<boolean> {
    const updated = await this.prisma.scheduleFollowUp.updateMany({
      where: {
        id: input.id,
        deliveryClaimedAt: input.claimAt,
        notifiedAt: null,
        draft: null,
      },
      data: { draft: input.draft },
    });
    return updated.count === 1;
  }

  async markFollowUpNotified(
    input: MarkFollowUpNotifiedInput,
  ): Promise<boolean> {
    return await this.prisma.$transaction(async (client) => {
      const found = await client.scheduleFollowUp.findUnique({
        where: { id: input.id },
      });
      if (!found) {
        return false;
      }
      const updated = await client.scheduleFollowUp.updateMany({
        where: {
          id: input.id,
          notifiedAt: null,
          deliveryClaimedAt: input.claimAt,
          triggerAt: input.triggerAt,
        },
        data: {
          draft: input.draft,
          notifiedAt: input.now,
          deliveryClaimedAt: null,
        },
      });
      if (updated.count === 0) {
        return false;
      }
      await client.scheduleEvent.createMany({
        skipDuplicates: true,
        data: [
          {
            scheduleItemId: found.scheduleItemId,
            kind: ScheduleEventKind.FOLLOW_UP_NOTIFIED,
            dedupeKey: String(input.id),
            payload: { followUpId: input.id },
            occurredAt: input.now,
          },
        ],
      });
      return true;
    });
  }

  async expireCandidates(now: Date): Promise<number> {
    const rows = await this.prisma.scheduleItem.findMany({
      where: {
        status: ScheduleStatus.CANDIDATE,
        candidateExpiresAt: { lte: now },
      },
      select: { id: true, slackUserId: true },
    });
    const results = await Promise.all(
      rows.map((row) =>
        this.transition({
          id: row.id,
          slackUserId: row.slackUserId,
          from: ScheduleStatus.CANDIDATE,
          to: ScheduleStatus.SKIPPED,
          now,
          actor: ScheduleActor.SWEEP,
        }),
      ),
    );
    return results.filter((result) => result !== null).length;
  }

  async addFollowUp(
    input: AddFollowUpInput,
  ): Promise<ScheduleFollowUpRecord | null> {
    const owner = await this.prisma.scheduleItem.findFirst({
      where: { id: input.scheduleItemId, slackUserId: input.slackUserId },
      select: { id: true, status: true },
    });
    if (!owner) {
      return null;
    }
    const created = await this.prisma.scheduleFollowUp.create({
      data: {
        scheduleItemId: input.scheduleItemId,
        recipient: input.recipient,
        topic: input.topic,
        trigger: input.trigger,
        triggerAt:
          input.trigger === FollowUpTrigger.ON_DONE
            ? owner.status === ScheduleStatus.DONE
              ? new Date()
              : null
            : (input.triggerAt ?? null),
      },
    });
    return toFollowUp(created);
  }

  async updateFollowUp(
    input: UpdateFollowUpInput,
  ): Promise<ScheduleFollowUpRecord | null> {
    const found = await this.prisma.scheduleFollowUp.findFirst({
      where: { id: input.id, scheduleItem: { slackUserId: input.slackUserId } },
    });
    if (!found) {
      return null;
    }
    const data: Prisma.ScheduleFollowUpUpdateInput = {
      recipient: input.recipient,
      topic: input.topic,
      sentAt: input.sentAt,
      triggerAt: input.triggerAt,
    };
    if (
      (input.recipient !== undefined && input.recipient !== found.recipient) ||
      (input.topic !== undefined && input.topic !== found.topic)
    ) {
      data.draft = null;
      data.deliveryClaimedAt = null;
    }
    if (
      input.triggerAt !== undefined &&
      input.triggerAt?.getTime() !== found.triggerAt?.getTime()
    ) {
      data.notifiedAt = null;
      data.deliveryClaimedAt = null;
    }
    const updated = await this.prisma.scheduleFollowUp.update({
      where: { id: input.id },
      data,
    });
    return toFollowUp(updated);
  }

  async addNote(input: AddNoteInput): Promise<ScheduleEventRecord | null> {
    const owner = await this.prisma.scheduleItem.findFirst({
      where: { id: input.scheduleItemId, slackUserId: input.slackUserId },
      select: { id: true },
    });
    if (!owner) {
      return null;
    }
    const created = await this.prisma.scheduleEvent.create({
      data: {
        scheduleItemId: input.scheduleItemId,
        kind: ScheduleEventKind.NOTE,
        payload: { text: input.text },
        occurredAt: input.now,
      },
    });
    return toEvent(created);
  }

  async addEvent(
    input: AddEventInput,
  ): Promise<ScheduleEventRecord | 'DUPLICATE'> {
    try {
      const created = await this.prisma.scheduleEvent.create({
        data: {
          scheduleItemId: input.scheduleItemId,
          kind: input.kind,
          payload: input.payload as Prisma.InputJsonValue,
          dedupeKey: input.dedupeKey ?? null,
          occurredAt: input.occurredAt,
        },
      });
      return toEvent(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return 'DUPLICATE';
      }
      throw error;
    }
  }

  async recordEventAndTransition(
    input: RecordEventAndTransitionInput,
  ): Promise<RecordedEventTransition | 'DUPLICATE'> {
    validateCompletedAt(input.transitionTo, input.completedAt, input.now);
    let eventCreateUniqueViolation = false;
    try {
      return await this.prisma.$transaction(async (client) => {
        try {
          await client.scheduleEvent.create({
            data: {
              scheduleItemId: input.event.scheduleItemId,
              kind: input.event.kind,
              payload: input.event.payload as Prisma.InputJsonValue,
              dedupeKey: input.event.dedupeKey ?? null,
              occurredAt: input.event.occurredAt,
            },
          });
        } catch (error) {
          eventCreateUniqueViolation = isUniqueViolation(error);
          throw error;
        }
        const before = await client.scheduleItem.findUnique({
          where: { id: input.event.scheduleItemId },
        });
        if (!before || before.slackUserId !== input.slackUserId) {
          return { item: null, transitioned: false };
        }
        if (
          input.transitionTo === null ||
          !input.transitionFrom.includes(before.status as ScheduleStatus)
        ) {
          return { item: toRecord(before), transitioned: false };
        }
        const item = await this.transitionInTransaction({
          client,
          input: {
            id: input.event.scheduleItemId,
            slackUserId: input.slackUserId,
            from: before.status as ScheduleStatus,
            to: input.transitionTo,
            now: input.now,
            completedAt: input.completedAt,
            actor: input.actor,
          },
        });
        return { item, transitioned: item !== null };
      });
    } catch (error) {
      if (eventCreateUniqueViolation && isUniqueViolation(error)) {
        return 'DUPLICATE';
      }
      throw error;
    }
  }

  async countPendingFollowUps({
    scheduleItemIds,
  }: CountPendingFollowUpsInput): Promise<Map<number, number>> {
    if (scheduleItemIds.length === 0) {
      return new Map();
    }
    const counts = await this.prisma.scheduleFollowUp.groupBy({
      by: ['scheduleItemId'],
      where: {
        scheduleItemId: { in: scheduleItemIds },
        notifiedAt: null,
        sentAt: null,
      },
      _count: { _all: true },
    });
    return new Map(counts.map((row) => [row.scheduleItemId, row._count._all]));
  }

  async findDetail({
    id,
    slackUserId,
  }: FindScheduleDetailInput): Promise<ScheduleDetail | null> {
    const found = await this.prisma.scheduleItem.findFirst({
      where: { id, slackUserId },
      include: {
        followUps: { orderBy: { id: 'asc' } },
        events: { orderBy: { occurredAt: 'desc' } },
      },
    });
    if (!found) {
      return null;
    }
    return {
      item: toRecord(found),
      followUps: found.followUps.map(toFollowUp),
      events: found.events.map(toEvent),
      pendingFollowUpCount: found.followUps.filter(
        (followUp) => followUp.notifiedAt === null && followUp.sentAt === null,
      ).length,
    };
  }

  async markAsHoliday(id: number): Promise<ScheduleItemRecord> {
    // `status` 와 `completedAt` 은 건드리지 않는다 — 사용자가 이미 완료를 눌러 둔 줄이면
    // 그 기록이 승격으로 지워지면 안 된다.
    const updated = await this.prisma.scheduleItem.update({
      where: { id },
      data: { isHoliday: true },
    });
    return toRecord(updated);
  }

  async deleteById(id: number): Promise<void> {
    await this.prisma.scheduleItem.delete({ where: { id } });
  }
}
