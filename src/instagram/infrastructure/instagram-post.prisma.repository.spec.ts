import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { assertClaimable } from '../domain/instagram-post.policy';
import {
  ClaimReelInput,
  InstagramPostField,
} from '../domain/instagram-post.type';
import { InstagramPostPrismaRepository } from './instagram-post.prisma.repository';

const input = {
  reelKey: '2026-11-05/ai',
  field: InstagramPostField.AI,
  title: 'title',
  videoPath: '/video',
  videoSha256: 'hash',
  caption: 'caption',
  previewActionId: 'card-1',
};

const upsertAndAssert = async (
  repository: InstagramPostPrismaRepository,
  claimInput: ClaimReelInput,
) => {
  const post = await repository.upsertByReelKey(claimInput);
  assertClaimable({ post, previewActionId: claimInput.previewActionId });
  return post;
};

describe('InstagramPostPrismaRepository.upsertByReelKey', () => {
  it('같은 previewId의 반복 선점은 같은 행을 반환한다', async () => {
    const row = { ...input, id: 'post-1', status: 'PENDING' };
    const upsert = jest.fn().mockResolvedValue(row);
    const repository = new InstagramPostPrismaRepository({
      instagramPost: { upsert },
    } as unknown as PrismaService);
    expect(await repository.upsertByReelKey(input)).toEqual({
      ...row,
      features: null,
    });
    expect(await repository.upsertByReelKey(input)).toEqual({
      ...row,
      features: null,
    });
    expect(upsert).toHaveBeenCalledTimes(2);
  });
  it('다른 previewId가 미게시 행을 선점하면 정책이 거절한다', async () => {
    const upsert = jest.fn().mockResolvedValue({ ...input, status: 'PENDING' });
    const repository = new InstagramPostPrismaRepository({
      instagramPost: { upsert },
    } as unknown as PrismaService);
    await expect(
      upsertAndAssert(repository, { ...input, previewActionId: 'card-2' }),
    ).rejects.toMatchObject({ errorCode: 'INSTAGRAM_REEL_CLAIMED' });
  });
  it('게시된 행은 다른 previewId에도 반환한다', async () => {
    const row = { ...input, status: 'PUBLISHED' };
    const upsert = jest.fn().mockResolvedValue(row);
    const repository = new InstagramPostPrismaRepository({
      instagramPost: { upsert },
    } as unknown as PrismaService);
    expect(
      await repository.upsertByReelKey({ ...input, previewActionId: 'card-2' }),
    ).toEqual({ ...row, features: null });
  });
  it('P2002 동시 생성 뒤 다시 읽은 행을 정책이 거절한다', async () => {
    const upsert = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );
    const findUnique = jest.fn().mockResolvedValue({
      ...input,
      id: 'post-1',
      status: 'PENDING',
    });
    const repository = new InstagramPostPrismaRepository({
      instagramPost: { upsert, findUnique },
    } as unknown as PrismaService);

    await expect(
      upsertAndAssert(repository, { ...input, previewActionId: 'card-2' }),
    ).rejects.toMatchObject({ errorCode: 'INSTAGRAM_REEL_CLAIMED' });
    expect(findUnique).toHaveBeenCalledWith({
      where: { reelKey: input.reelKey },
    });
  });
});

describe('InstagramPostPrismaRepository.listPublishedSince', () => {
  it('기준 시각 뒤에 게시된 행을 게시 순으로 읽는다', async () => {
    const since = new Date('2026-10-28T00:00:00Z');
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { ...input, id: 'post-1', status: 'PUBLISHED', features: null },
      ]);
    const repository = new InstagramPostPrismaRepository({
      instagramPost: { findMany },
    } as unknown as PrismaService);

    const [post] = await repository.listPublishedSince(since);

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'PUBLISHED', publishedAt: { gte: since } },
      orderBy: { publishedAt: 'asc' },
    });
    expect(post.features).toBeNull();
  });
});

describe('InstagramPostPrismaRepository.setFeatures', () => {
  it('특성을 그 행에 저장한다', async () => {
    const update = jest.fn().mockResolvedValue({});
    const repository = new InstagramPostPrismaRepository({
      instagramPost: { update },
    } as unknown as PrismaService);
    const features = { version: 1 } as never;

    await repository.setFeatures({ id: 'post-1', features });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: { features },
    });
  });
});
