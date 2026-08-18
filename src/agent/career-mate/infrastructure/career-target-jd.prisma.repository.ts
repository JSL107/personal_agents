import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { CareerTargetJdData } from '../domain/career-mate.type';
import {
  CareerTargetJdRepositoryPort,
  SaveCareerTargetJdInput,
} from '../domain/port/career-target-jd.repository.port';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

@Injectable()
export class CareerTargetJdPrismaRepository implements CareerTargetJdRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: SaveCareerTargetJdInput): Promise<void> {
    await this.prisma.careerTargetJd.create({
      data: {
        slackUserId: input.slackUserId,
        company: input.company,
        role: input.role,
        jdText: input.jdText,
      },
    });
  }

  async findActiveBySlackUser(
    slackUserId: string,
    maxAgeDays: number,
  ): Promise<CareerTargetJdData | null> {
    const cutoff = new Date(Date.now() - maxAgeDays * DAY_IN_MILLISECONDS);
    const row = await this.prisma.careerTargetJd.findFirst({
      where: { slackUserId, createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      company: row.company,
      role: row.role,
      jdText: row.jdText,
      createdAt: row.createdAt,
    };
  }
}
