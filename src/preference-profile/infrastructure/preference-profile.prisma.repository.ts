import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ActiveProfile,
  PreferenceProfileRepositoryPort,
} from '../domain/port/preference-profile.repository.port';
import { parseProfile } from '../domain/preference-profile.parser';
import { PreferenceProfile } from '../domain/preference-profile.type';

@Injectable()
export class PreferenceProfilePrismaRepository implements PreferenceProfileRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(ownerUserId: string): Promise<ActiveProfile | null> {
    const found = await this.prisma.userPreferenceProfile.findFirst({
      where: { ownerUserId, supersededAt: null },
      orderBy: { version: 'desc' },
    });
    if (!found) {
      return null;
    }
    return { version: found.version, profile: parseProfile(found.profileJson) };
  }

  async saveNewVersion(
    ownerUserId: string,
    version: number,
    profile: PreferenceProfile,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userPreferenceProfile.updateMany({
        where: { ownerUserId, supersededAt: null },
        data: { supersededAt: new Date() },
      }),
      this.prisma.userPreferenceProfile.create({
        data: {
          ownerUserId,
          version,
          profileJson: profile as unknown as object,
        },
      }),
    ]);
  }
}
