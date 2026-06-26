import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SubconsciousBaselineRepository } from '../domain/port/subconscious-baseline.repository.port';
import { StateSnapshot } from '../domain/subconscious.type';

@Injectable()
export class SubconsciousBaselinePrismaRepository
  implements SubconsciousBaselineRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async findBySource(
    ownerUserId: string,
    sourceId: string,
  ): Promise<StateSnapshot | null> {
    const found = await this.prisma.subconsciousBaseline.findUnique({
      where: { ownerUserId_sourceId: { ownerUserId, sourceId } },
    });
    if (!found) {
      return null;
    }
    return found.snapshot as unknown as StateSnapshot;
  }

  async upsert(
    ownerUserId: string,
    sourceId: string,
    snapshot: StateSnapshot,
  ): Promise<void> {
    await this.prisma.subconsciousBaseline.upsert({
      where: { ownerUserId_sourceId: { ownerUserId, sourceId } },
      create: {
        ownerUserId,
        sourceId,
        contentHash: snapshot.contentHash,
        snapshot: snapshot as unknown as object,
      },
      update: {
        contentHash: snapshot.contentHash,
        snapshot: snapshot as unknown as object,
      },
    });
  }
}
