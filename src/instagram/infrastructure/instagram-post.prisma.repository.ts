import { Injectable } from '@nestjs/common';
import { InstagramPost as InstagramPostRow, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ClaimReelInput,
  InstagramPost,
  InstagramPostField,
  InstagramPostPatch,
  InstagramPostStatus,
} from '../domain/instagram-post.type';
import { InstagramPostRepositoryPort } from '../domain/port/instagram-post.repository.port';

@Injectable()
export class InstagramPostPrismaRepository implements InstagramPostRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsertByReelKey(input: ClaimReelInput): Promise<InstagramPost> {
    const row = await this.upsertOrFind(input);
    return toDomain(row);
  }

  async update({
    id,
    patch,
  }: {
    id: string;
    patch: InstagramPostPatch;
  }): Promise<InstagramPost> {
    const row = await this.prisma.instagramPost.update({
      where: { id },
      data: patch,
    });
    return toDomain(row);
  }

  async findByReelKey(reelKey: string): Promise<InstagramPost | null> {
    const row = await this.prisma.instagramPost.findUnique({
      where: { reelKey },
    });
    return row ? toDomain(row) : null;
  }

  private async upsertOrFind(input: ClaimReelInput): Promise<InstagramPostRow> {
    try {
      return await this.prisma.instagramPost.upsert({
        where: { reelKey: input.reelKey },
        create: { ...input, status: InstagramPostStatus.PENDING },
        update: {},
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const row = await this.prisma.instagramPost.findUnique({
        where: { reelKey: input.reelKey },
      });
      if (!row) {
        throw error;
      }
      return row;
    }
  }
}

export const toDomain = (row: InstagramPostRow): InstagramPost => {
  const field = Object.values(InstagramPostField).find(
    (value) => value === row.field,
  );
  if (!field) {
    throw new Error(`알 수 없는 InstagramPost field: ${row.field}`);
  }
  const status = Object.values(InstagramPostStatus).find(
    (value) => value === row.status,
  );
  if (!status) {
    throw new Error(`알 수 없는 InstagramPost status: ${row.status}`);
  }
  return { ...row, field, status };
};
