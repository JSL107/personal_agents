import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { PrismaService } from '../../prisma/prisma.service';
import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import { PreviewActionException } from '../domain/preview-action.exception';
import {
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
        responseUrl: input.responseUrl ?? null,
        expiresAt,
      },
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<PreviewAction | null> {
    const row = await this.prisma.previewAction.findUnique({ where: { id } });
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
}

// Prisma row → domain. unknown kind/status 는 검증 실패로 끊어 silent corruption 회피.
const toDomain = (row: {
  id: string;
  slackUserId: string;
  kind: string;
  payload: Prisma.JsonValue;
  status: string;
  previewText: string;
  responseUrl: string | null;
  expiresAt: Date;
  createdAt: Date;
  appliedAt: Date | null;
  cancelledAt: Date | null;
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
    responseUrl: row.responseUrl,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    appliedAt: row.appliedAt,
    cancelledAt: row.cancelledAt,
  };
};
