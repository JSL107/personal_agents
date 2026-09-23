import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PreviewActionRepositoryPort,
  PreviewDayOutcomeRow,
  PreviewOutcomeRow,
} from '../domain/port/preview-action.repository.port';
import { PreviewActionException } from '../domain/preview-action.exception';
import {
  ApplyProgressState,
  CreatePreviewInput,
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
  PreviewKind,
  PreviewStatus,
} from '../domain/preview-action.type';
import { PreviewActionErrorCode } from '../domain/preview-action-error-code.enum';

const PREVIEW_KIND_VALUES: ReadonlySet<PreviewKind> = new Set(
  Object.values(PREVIEW_KIND),
);
const PREVIEW_STATUS_VALUES: ReadonlySet<PreviewStatus> = new Set(
  Object.values(PREVIEW_STATUS),
);

@Injectable()
export class PreviewActionPrismaRepository implements PreviewActionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreatePreviewInput): Promise<PreviewAction> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + input.ttlMs);
    const row = await this.prisma.previewAction.create({
      data: {
        id,
        slackUserId: input.slackUserId,
        kind: input.kind,
        payload: input.payload as unknown as Prisma.InputJsonValue,
        status: PREVIEW_STATUS.PENDING,
        previewText: input.previewText,
        expiresAt,
        slackChannelId: null,
        slackMessageTs: null,
      },
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<PreviewAction | null> {
    const row = await this.prisma.previewAction.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findLatestPendingForUser({
    slackUserId,
    now,
  }: {
    slackUserId: string;
    now: Date;
  }): Promise<PreviewAction | null> {
    const row = await this.prisma.previewAction.findFirst({
      where: {
        slackUserId,
        status: PREVIEW_STATUS.PENDING,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  async transition({
    id,
    status,
  }: {
    id: string;
    status: Exclude<PreviewStatus, 'PENDING'>;
  }): Promise<PreviewAction> {
    const now = new Date();
    const row = await this.prisma.previewAction.update({
      where: { id },
      data: {
        status,
        appliedAt: status === PREVIEW_STATUS.APPLIED ? now : undefined,
        cancelledAt: status === PREVIEW_STATUS.CANCELLED ? now : undefined,
      },
    });
    return toDomain(row);
  }

  // `where` 에 status 를 함께 걸어 전이를 원자적으로 획득한다. Prisma 의 `update` 는 where 에
  // unique 필드만 받으므로 `updateMany` 를 쓴다 — 갱신 행이 0 이면 그 사이 다른 경로가
  // 상태를 바꿨다는 뜻이라 아무것도 하지 않고 null.
  async transitionIfStatus({
    id,
    from,
    to,
  }: {
    id: string;
    from: PreviewStatus;
    to: PreviewStatus;
  }): Promise<PreviewAction | null> {
    const now = new Date();
    const { count } = await this.prisma.previewAction.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        appliedAt: to === PREVIEW_STATUS.APPLIED ? now : undefined,
        cancelledAt: to === PREVIEW_STATUS.CANCELLED ? now : undefined,
      },
    });
    if (count === 0) {
      return null;
    }
    const row = await this.prisma.previewAction.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async updatePayload({
    id,
    payload,
  }: {
    id: string;
    payload: unknown;
  }): Promise<PreviewAction> {
    const row = await this.prisma.previewAction.update({
      where: { id },
      data: { payload: payload as unknown as Prisma.InputJsonValue },
    });
    return toDomain(row);
  }

  async countOutcomesByKind({
    sinceDays,
    now,
  }: {
    sinceDays: number;
    now: Date;
  }): Promise<PreviewOutcomeRow[]> {
    const since = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000);
    const byStatus = await this.prisma.previewAction.groupBy({
      by: ['kind', 'status'],
      where: {
        createdAt: { gte: since },
        status: { in: ['APPLIED', 'CANCELLED', 'EXPIRED'] },
      },
      _count: { _all: true },
    });
    const staleExpired = await this.prisma.previewAction.groupBy({
      by: ['kind'],
      where: {
        createdAt: { gte: since },
        status: 'PENDING',
        expiresAt: { lte: now },
      },
      _count: { _all: true },
    });

    const outcomesByKind = new Map<string, PreviewOutcomeRow>();
    const ensureOutcome = (kind: string): PreviewOutcomeRow => {
      const found = outcomesByKind.get(kind);
      if (found) {
        return found;
      }
      const created = { kind, applied: 0, cancelled: 0, expired: 0 };
      outcomesByKind.set(kind, created);
      return created;
    };

    for (const row of byStatus) {
      if (row.status === 'APPLIED') {
        ensureOutcome(row.kind).applied += row._count._all;
      } else if (row.status === 'CANCELLED') {
        ensureOutcome(row.kind).cancelled += row._count._all;
      } else if (row.status === 'EXPIRED') {
        ensureOutcome(row.kind).expired += row._count._all;
      }
    }
    for (const row of staleExpired) {
      ensureOutcome(row.kind).expired += row._count._all;
    }
    return [...outcomesByKind.values()];
  }

  async countByPayloadValue({
    kind,
    payloadPath,
    payloadValue,
  }: {
    kind: string;
    payloadPath: string[];
    payloadValue: string;
  }): Promise<number> {
    return this.prisma.previewAction.count({
      where: {
        kind,
        payload: { path: payloadPath, equals: payloadValue },
      },
    });
  }

  // status 는 손대지 않는다 — 실행 실패는 거부가 아니므로 PENDING 을 유지해야 재시도가 살아 있다.
  async recordApplyFailure(input: {
    id: string;
    reason: string;
    at: Date;
  }): Promise<void> {
    await this.prisma.previewAction.update({
      where: { id: input.id },
      data: {
        lastFailedAt: input.at,
        lastFailureReason: input.reason,
      },
    });
  }

  // 소유권을 획득한다. 잡지 못하면 아무것도 쓰지 않고 null 을 돌려준다.
  //
  // 막아야 하는 것이 둘이고 수단도 둘이다.
  //
  // **① 활성 소유자 배제(가드).** 끝나지 않은 흔적(`endedAt` 없음)이 있으면 그 반영은 지금
  // 누군가 돌리고 있다는 뜻이므로 잡지 않는다. 이 가드가 없으면 CAS 만으로는 못 막는다 —
  // B 가 A 의 `updateMany` **직후** 읽으면 A 가 방금 쓴 값을 `previous` 로 들고 같은 값을
  // 조건에 걸어 통과하므로, 아직 돌고 있는 A 의 반영을 탈취해 둘 다 applier 를 실행한다.
  // CAS 는 동시에 읽은 경우만 가르는 도구이지 상호 배제가 아니다.
  //
  // 예외는 `takeOverPid` 다. 부팅 훅이 그 프로세스의 죽음을 확인한 경우에만 명시해서 넘기고,
  // 그때만 활성으로 보이는 흔적을 이어받는다(죽은 프로세스는 스스로 `endedAt` 을 못 남긴다).
  //
  // **② read-modify-write 레이스(CAS).** 둘이 같은 상태를 동시에 읽으면 가드는 둘 다
  // 통과시키므로, 쓰기 조건으로 한쪽만 남긴다. 비교 키는 `startedAt` — 시도마다 새로 찍혀
  // 그 시도를 유일하게 특정한다.
  async beginApply({
    id,
    pid,
    at,
    takeOverPid,
  }: {
    id: string;
    pid: number;
    at: Date;
    takeOverPid?: number;
  }): Promise<ApplyProgressState | null> {
    const row = await this.prisma.previewAction.findUnique({
      where: { id },
      select: { applyProgress: true },
    });
    const previous = row === null ? null : toApplyProgress(row.applyProgress);
    // ① 아직 끝나지 않은 남의 반영은 건드리지 않는다.
    if (
      previous !== null &&
      previous.endedAt === undefined &&
      previous.pid !== takeOverPid
    ) {
      return null;
    }
    // `done` 은 물려받고 `attempts` 만 올린다 — 물려받지 않으면 재개가 처음부터 다시 돌아
    // 이어붙이는 의미가 없고, 세지 않으면 크래시를 일으키는 반영이 부팅마다 되살아난다.
    // `endedAt` 은 싣지 않는다. 새 시도가 시작됐으므로 "끝났다" 표시는 지워져야 한다.
    const next: ApplyProgressState = {
      pid,
      startedAt: at.toISOString(),
      attempts: (previous?.attempts ?? 0) + 1,
      done: previous?.done ?? [],
    };
    // ② 읽은 그 시도 위에만 쓴다.
    const { count } = await this.prisma.previewAction.updateMany({
      where: {
        id,
        applyProgress:
          previous === null
            ? { equals: Prisma.DbNull }
            : { path: ['startedAt'], equals: previous.startedAt },
      },
      data: { applyProgress: next as unknown as Prisma.InputJsonValue },
    });
    return count === 0 ? null : next;
  }

  // 읽은 진행 흔적이 그대로일 때만 거절로 전이한다.
  //
  // 가드(활성 여부 확인)와 전이가 따로 있으면 그 사이로 `beginApply` 가 끼어든다 — 가드는
  // 이미 읽어 둔 값만 보고 통과하고 전이는 조건 없이 덮어쓴다. 그러면 사용자의 거절과 막
  // 시작된 반영이 충돌해, **canceller 는 돌았는데 상태는 나중에 `transition(APPLIED)` 가
  // 덮어써** 둘이 어긋난다. 검사와 쓰기가 같은 조건 안에 있어야 한다.
  //
  // 비교 키는 `beginApply` 와 같은 `startedAt` 이다 — 새 시도가 시작되면 반드시 바뀐다.
  // 상태도 함께 걸어 PENDING 검증까지 이 한 번의 쓰기 안으로 들인다.
  async cancelIfProgressUnchanged({
    id,
    expectedStartedAt,
  }: {
    id: string;
    expectedStartedAt: string | null;
  }): Promise<PreviewAction | null> {
    const { count } = await this.prisma.previewAction.updateMany({
      where: {
        id,
        status: PREVIEW_STATUS.PENDING,
        applyProgress:
          expectedStartedAt === null
            ? { equals: Prisma.DbNull }
            : { path: ['startedAt'], equals: expectedStartedAt },
      },
      data: { status: PREVIEW_STATUS.CANCELLED, cancelledAt: new Date() },
    });
    if (count === 0) {
      return null;
    }
    const row = await this.prisma.previewAction.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  // 이 시도가 끝났음을 표시한다. `done` 은 그대로 둔다 — 실패했든 마감했든 이미 반영된 단계는
  // 이미 반영된 것이고, 그것을 지우면 다음 승인이 처음부터 다시 실행한다.
  //
  // 성공 경로는 이걸 쓰지 않고 `clearApplyProgress` 로 통째로 지운다. 카드가 APPLIED 로 끝나
  // 다시 눌릴 일이 없으므로 남겨 둘 이유가 없다.
  async endApply({
    id,
    pid,
    at,
  }: {
    id: string;
    pid: number;
    at: Date;
  }): Promise<void> {
    const row = await this.prisma.previewAction.findUnique({
      where: { id },
      select: { applyProgress: true },
    });
    const current = row === null ? null : toApplyProgress(row.applyProgress);
    // 내 흔적이 아니면 건드리지 않는다 — 다른 프로세스가 이미 새 시도를 시작했다는 뜻이다.
    if (current === null || current.pid !== pid) {
      return;
    }
    await this.prisma.previewAction.updateMany({
      where: { id, applyProgress: { path: ['pid'], equals: pid } },
      data: {
        applyProgress: {
          ...current,
          endedAt: at.toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // 읽고 고쳐 쓴다. jsonb 를 제자리에서 이어붙이려면 raw SQL 이 필요한데 이 레포는 쓰지 않고,
  // 한 카드의 단계는 applier 가 순차로 돌려 같은 순간에 둘이 기록하는 일이 없다. 두 프로세스가
  // 같은 카드를 동시에 반영하는 경우라면 기록이 겹치기 전에 그 자체가 이미 사고다.
  async recordApplyStep({
    id,
    step,
  }: {
    id: string;
    step: string;
  }): Promise<void> {
    const row = await this.prisma.previewAction.findUnique({
      where: { id },
      select: { applyProgress: true },
    });
    const current = row === null ? null : toApplyProgress(row.applyProgress);
    // 흔적이 없으면 이 반영은 이미 끝난 것으로 마감됐다는 뜻이다. 되살리지 않는다.
    // 같은 단계가 두 번 들어오는 것은 재개가 기록을 물려받아 정상적으로 생길 수 있다.
    if (current === null || current.done.includes(step)) {
      return;
    }
    await this.prisma.previewAction.update({
      where: { id },
      data: {
        applyProgress: {
          ...current,
          done: [...current.done, step],
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async clearApplyProgress({
    id,
    pid,
  }: {
    id: string;
    pid: number;
  }): Promise<void> {
    // pid 를 where 에 걸어 **내가 새긴 흔적만** 지운다. 다른 프로세스가 같은 카드를 쥐고
    // 있으면 그쪽 기록이 정본이고, 그것까지 지우면 그 반영이 죽었을 때 중단을 알아볼 수 없다.
    await this.prisma.previewAction.updateMany({
      where: { id, applyProgress: { path: ['pid'], equals: pid } },
      data: { applyProgress: Prisma.DbNull },
    });
  }

  async findApplyInterrupted(): Promise<PreviewAction[]> {
    const rows = await this.prisma.previewAction.findMany({
      where: {
        status: PREVIEW_STATUS.PENDING,
        applyProgress: { not: Prisma.DbNull },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  async attachSlackMessage(input: {
    id: string;
    slackChannelId: string;
    slackMessageTs: string;
  }): Promise<void> {
    await this.prisma.previewAction.update({
      where: { id: input.id },
      data: {
        slackChannelId: input.slackChannelId,
        slackMessageTs: input.slackMessageTs,
      },
    });
  }

  async findExpiredPending(input: {
    now: Date;
    limit: number;
  }): Promise<PreviewAction[]> {
    const rows = await this.prisma.previewAction.findMany({
      where: { status: PREVIEW_STATUS.PENDING, expiresAt: { lte: input.now } },
      take: input.limit,
      orderBy: { expiresAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  // 콘솔 관제 — 아직 열려 있는(PENDING & 미만료) preview 전체. 최신 생성순.
  async findAllOpen({ now }: { now: Date }): Promise<PreviewAction[]> {
    const rows = await this.prisma.previewAction.findMany({
      where: { status: PREVIEW_STATUS.PENDING, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }

  async findRecentAppliedByKind({
    kind,
    since,
    limit,
  }: {
    kind: PreviewKind;
    since: Date;
    limit: number;
  }): Promise<PreviewAction[]> {
    const rows = await this.prisma.previewAction.findMany({
      // 적용 시각으로 자른다. 카드를 만든 시각으로 자르면 오래 열려 있다 뒤늦게 승인된 카드가
      // 창 밖으로 밀려난다 — 실제로 나간 것을 못 보게 된다.
      where: {
        kind,
        status: PREVIEW_STATUS.APPLIED,
        appliedAt: { gte: since },
      },
      orderBy: { appliedAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async findAllDayOutcomes(): Promise<PreviewDayOutcomeRow[]> {
    const rows = await this.prisma.previewAction.findMany({
      select: { createdAt: true, appliedAt: true, cancelledAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      createdAt: row.createdAt,
      // 승인과 거절 중 실제로 찍힌 쪽이 결말이다. 둘 다 비면 무응답 만료 또는 아직 열린 카드다.
      closedAt: row.appliedAt ?? row.cancelledAt,
    }));
  }
}

// Prisma row → domain. unknown kind/status 는 검증 실패로 끊어 silent corruption 회피.
const toDomain = (row: {
  id: string;
  slackUserId: string;
  kind: string;
  payload: Prisma.JsonValue;
  status: string;
  previewText: string;
  expiresAt: Date;
  createdAt: Date;
  appliedAt: Date | null;
  cancelledAt: Date | null;
  slackChannelId: string | null;
  slackMessageTs: string | null;
  lastFailedAt: Date | null;
  lastFailureReason: string | null;
  applyProgress: Prisma.JsonValue;
}): PreviewAction => {
  if (!PREVIEW_KIND_VALUES.has(row.kind as PreviewKind)) {
    throw new PreviewActionException({
      code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
      message: `알 수 없는 PreviewAction kind: ${row.kind}`,
      status: DomainStatus.INTERNAL,
    });
  }
  if (!PREVIEW_STATUS_VALUES.has(row.status as PreviewStatus)) {
    throw new PreviewActionException({
      code: PreviewActionErrorCode.NOT_FOUND,
      message: `알 수 없는 PreviewAction status: ${row.status}`,
      status: DomainStatus.INTERNAL,
    });
  }
  return {
    id: row.id,
    slackUserId: row.slackUserId,
    kind: row.kind as PreviewKind,
    payload: row.payload as unknown,
    status: row.status as PreviewStatus,
    previewText: row.previewText,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    appliedAt: row.appliedAt,
    cancelledAt: row.cancelledAt,
    slackChannelId: row.slackChannelId,
    slackMessageTs: row.slackMessageTs,
    lastFailedAt: row.lastFailedAt,
    lastFailureReason: row.lastFailureReason,
    applyProgress: toApplyProgress(row.applyProgress),
  };
};

// jsonb → ApplyProgressState. 형태가 맞지 않으면 null 로 떨어뜨린다.
//
// kind/status 와 달리 **예외로 끊지 않는다.** 이 값은 카드의 내용이 아니라 진행 흔적이고,
// 깨진 흔적 하나 때문에 조회가 통째로 실패하면 그 카드는 승인도 취소도 할 수 없게 된다.
// null 로 떨어지면 부팅 훅이 그 행을 중단 후보로 보지 않을 뿐이다 — 최악이 "재개를 놓친다"
// 이므로, 읽기를 막는 쪽보다 낫다.
const toApplyProgress = (
  value: Prisma.JsonValue,
): ApplyProgressState | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const { pid, startedAt, attempts, done, endedAt } = value as Record<
    string,
    unknown
  >;
  if (
    typeof pid !== 'number' ||
    typeof startedAt !== 'string' ||
    typeof attempts !== 'number' ||
    !Array.isArray(done) ||
    !done.every((step): step is string => typeof step === 'string')
  ) {
    return null;
  }
  return {
    pid,
    startedAt,
    attempts,
    done,
    ...(typeof endedAt === 'string' ? { endedAt } : {}),
  };
};
