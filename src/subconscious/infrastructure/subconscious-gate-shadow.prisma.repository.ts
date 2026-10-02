import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  SubconsciousGateShadowRecord,
  SubconsciousGateShadowRepository,
} from '../domain/port/subconscious-gate-shadow.repository.port';

@Injectable()
export class SubconsciousGateShadowPrismaRepository implements SubconsciousGateShadowRepository {
  constructor(private readonly prisma: PrismaService) {}

  async recordMany(
    records: readonly SubconsciousGateShadowRecord[],
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.prisma.subconsciousGateShadow.createMany({
      data: records.map((record) => ({ ...record })),
    });
  }
}
