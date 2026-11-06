import { Injectable } from '@nestjs/common';
import {
  InstagramInsightSnapshot as InstagramInsightSnapshotRow,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  InsightSnapshot,
  NewInsightSnapshot,
  SnapshotError,
  SnapshotWindow,
} from '../domain/instagram-insight.type';
import { InstagramInsightSnapshotRepositoryPort } from '../domain/port/instagram-insight-snapshot.repository.port';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class InstagramInsightSnapshotPrismaRepository implements InstagramInsightSnapshotRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async insertIfAbsent(snapshot: NewInsightSnapshot): Promise<boolean> {
    const { metrics, raw, ...rest } = snapshot;
    try {
      await this.prisma.instagramInsightSnapshot.create({
        data: { ...rest, ...metrics, raw: raw as Prisma.InputJsonValue },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  async listByPostIds(postIds: string[]): Promise<InsightSnapshot[]> {
    if (postIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.instagramInsightSnapshot.findMany({
      where: { postId: { in: postIds } },
    });
    return rows.map(toSnapshot);
  }
}

// 같은 (게시물, 창) 이 이미 있을 때 Prisma 가 내는 고유 제약 위반(P2002).
const isUniqueViolation = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  return error.code === UNIQUE_CONSTRAINT_VIOLATION;
};

const toSnapshot = (row: InstagramInsightSnapshotRow): InsightSnapshot => {
  const snapshotWindow = Object.values(SnapshotWindow).find(
    (value) => value === row.snapshotWindow,
  );
  if (!snapshotWindow) {
    throw new Error(`알 수 없는 스냅숏 창: ${row.snapshotWindow}`);
  }
  const error =
    Object.values(SnapshotError).find((value) => value === row.error) ?? null;
  return {
    id: row.id,
    postId: row.postId,
    snapshotWindow,
    capturedAt: row.capturedAt,
    ageMinutes: row.ageMinutes,
    metrics: {
      views: row.views,
      reach: row.reach,
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
      saved: row.saved,
      totalInteractions: row.totalInteractions,
      reposts: row.reposts,
      replies: row.replies,
      avgWatchMs: row.avgWatchMs,
      totalWatchMs: row.totalWatchMs,
      skipRate: row.skipRate,
    },
    followersCount: row.followersCount,
    error,
    raw: row.raw,
  };
};
