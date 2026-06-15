import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { CareerProfileData } from '../domain/career-mate.type';
import {
  CareerProfileRepositoryPort,
  CareerProfileSnapshot,
  SaveCareerProfileInput,
} from '../domain/port/career-profile.repository.port';

@Injectable()
export class CareerProfilePrismaRepository implements CareerProfileRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: SaveCareerProfileInput): Promise<{ id: number }> {
    const row = await this.prisma.careerProfile.create({
      data: {
        agentRunId: input.agentRunId,
        slackUserId: input.slackUserId,
        githubLogin: input.githubLogin,
        // windowStart 는 'YYYY-MM-DD' → UTC 자정 Date 로 파싱, @db.Date 가 날짜부만 저장.
        // write-only 메타라 로컬 타임존 타임스탬프로 다시 읽지 않는다.
        windowStart: new Date(input.windowStart),
        prCount: input.prCount,
        summary: input.summary,
        profileJson: input.profileJson as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async findLatestBySlackUser(
    slackUserId: string,
  ): Promise<CareerProfileSnapshot | null> {
    const row = await this.prisma.careerProfile.findFirst({
      where: { slackUserId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        agentRunId: true,
        profileJson: true,
        createdAt: true,
      },
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      agentRunId: row.agentRunId,
      profileJson: row.profileJson as unknown as CareerProfileData,
      createdAt: row.createdAt,
    };
  }
}
