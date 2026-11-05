import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { InstagramException } from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import {
  ClaimReelInput,
  InstagramPost,
  InstagramPostPatch,
} from '../domain/instagram-post.type';
import { InstagramPostRepositoryPort } from '../domain/port/instagram-post.repository.port';

@Injectable()
export class InstagramPostPrismaRepository implements InstagramPostRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async claim(input: ClaimReelInput): Promise<InstagramPost> {
    const row = await this.prisma.instagramPost.upsert({
      where: { reelKey: input.reelKey },
      create: { ...input, status: 'PENDING' },
      update: {},
    });
    if (
      row.previewActionId !== input.previewActionId &&
      row.status !== 'PUBLISHED'
    ) {
      throw new InstagramException({
        code: InstagramErrorCode.REEL_CLAIMED,
        message: '같은 릴스의 다른 카드가 맡고 있습니다',
      });
    }
    return row as InstagramPost;
  }

  async update(id: string, patch: InstagramPostPatch): Promise<InstagramPost> {
    if (patch.status === null) {
      throw new InstagramException({
        code: InstagramErrorCode.INVALID_PAYLOAD,
        message: '게시 상태는 null일 수 없습니다',
      });
    }
    const row = await this.prisma.instagramPost.update({
      where: { id },
      data: patch as InstagramPostPatch & { status?: string },
    });
    return row as InstagramPost;
  }

  async findByReelKey(reelKey: string): Promise<InstagramPost | null> {
    const row = await this.prisma.instagramPost.findUnique({
      where: { reelKey },
    });
    return row as InstagramPost | null;
  }
}
