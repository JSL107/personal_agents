import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ReactionSignalRepositoryPort,
  ReactionSignalRow,
  RecordReactionInput,
} from '../domain/port/reaction-signal.repository.port';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// 조회 상한 — 형제 소스(preview_decision)의 FETCH_LIMIT 과 같은 자리다. 반응은 클릭 한 번이라
// 다른 신호보다 쉽게 쌓이는데, 상한이 없으면 창 안의 전건을 메모리로 올린다.
const FETCH_LIMIT = 500;

// 저장 본문 상한. 신호로는 300자만 쓰지만(ReactionSignalSource.TEXT_CAP) 원문을 조금 더 남겨
// 사후에 "무엇에 달린 반응이었나" 를 되짚을 수 있게 한다. 다이제스트 카드는 수천 자라
// 상한이 없으면 쓰지 않는 본문이 테이블을 채운다.
const MESSAGE_TEXT_CAP = 1_000;

@Injectable()
export class ReactionSignalPrismaRepository implements ReactionSignalRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordReactionInput): Promise<void> {
    try {
      await this.prisma.slackReactionSignal.create({
        data: {
          ...input,
          messageText: input.messageText.slice(0, MESSAGE_TEXT_CAP),
        },
      });
    } catch (error: unknown) {
      // 토글(끄기 → 켜기)로 같은 반응이 두 번 들어오는 경우 — 중복 저장 대신 조용히 무시.
      if (this.isDuplicateReaction(error)) {
        return;
      }
      throw error;
    }
  }

  async recentReactions(
    ownerUserId: string,
    sinceMs: number,
  ): Promise<ReactionSignalRow[]> {
    const rows = await this.prisma.slackReactionSignal.findMany({
      where: {
        slackUserId: ownerUserId,
        createdAt: { gte: new Date(sinceMs) },
      },
      orderBy: { createdAt: 'desc' },
      take: FETCH_LIMIT,
    });
    return rows.map((row) => this.toRow(row));
  }

  private isDuplicateReaction(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_CONSTRAINT_VIOLATION
    );
  }

  private toRow(row: {
    id: number;
    emoji: string;
    messageText: string;
  }): ReactionSignalRow {
    return { id: row.id, emoji: row.emoji, messageText: row.messageText };
  }
}
