import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  NewInsightSnapshot,
  SnapshotWindow,
} from '../domain/instagram-insight.type';
import { InstagramInsightSnapshotPrismaRepository } from './instagram-insight-snapshot.prisma.repository';

const snapshot: NewInsightSnapshot = {
  postId: 'post-1',
  snapshotWindow: SnapshotWindow.H24,
  capturedAt: new Date('2026-11-06T05:40:00Z'),
  ageMinutes: 1450,
  metrics: {
    views: 84,
    reach: 71,
    likes: 2,
    comments: 0,
    shares: null,
    saved: 0,
    totalInteractions: 2,
    reposts: 0,
    replies: null,
    avgWatchMs: 4432,
    totalWatchMs: 323573,
    skipRate: 69.7,
  },
  followersCount: 2,
  error: null,
  raw: [{ name: 'views', values: [{ value: 84 }] }],
};

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

const repositoryWith = (delegate: Record<string, jest.Mock>) =>
  new InstagramInsightSnapshotPrismaRepository({
    instagramInsightSnapshot: delegate,
  } as unknown as PrismaService);

describe('InstagramInsightSnapshotPrismaRepository.insertIfAbsent', () => {
  it('새로 넣으면 true 를 돌려주고 지표를 열 이름으로 펼쳐 저장한다', async () => {
    const create = jest.fn().mockResolvedValue({});
    const repository = repositoryWith({ create });

    expect(await repository.insertIfAbsent(snapshot)).toBe(true);
    const { data } = create.mock.calls[0][0];
    expect(data).toMatchObject({
      postId: 'post-1',
      snapshotWindow: 'H24',
      ageMinutes: 1450,
      views: 84,
      shares: null,
      avgWatchMs: 4432,
      skipRate: 69.7,
      followersCount: 2,
      error: null,
    });
    expect(data).not.toHaveProperty('metrics');
  });

  it('같은 창이 이미 있으면(P2002) false 를 돌려준다', async () => {
    const create = jest.fn().mockRejectedValue(uniqueViolation());
    expect(await repositoryWith({ create }).insertIfAbsent(snapshot)).toBe(
      false,
    );
  });

  it('다른 오류는 그대로 던진다', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(
      repositoryWith({ create }).insertIfAbsent(snapshot),
    ).rejects.toThrow('db down');
  });
});

describe('InstagramInsightSnapshotPrismaRepository.listByPostIds', () => {
  it('빈 목록이면 DB 를 부르지 않는다', async () => {
    const findMany = jest.fn();
    expect(await repositoryWith({ findMany }).listByPostIds([])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('저장된 행을 도메인 스냅숏으로 되돌린다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'snap-1',
        postId: 'post-1',
        snapshotWindow: 'STORY',
        capturedAt: snapshot.capturedAt,
        ageMinutes: 1300,
        views: null,
        reach: null,
        likes: null,
        comments: null,
        shares: null,
        saved: null,
        totalInteractions: null,
        reposts: null,
        replies: null,
        avgWatchMs: null,
        totalWatchMs: null,
        skipRate: null,
        followersCount: 2,
        error: 'NOT_ENOUGH_VIEWERS',
        raw: [],
        createdAt: snapshot.capturedAt,
      },
    ]);
    const [found] = await repositoryWith({ findMany }).listByPostIds([
      'post-1',
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { postId: { in: ['post-1'] } },
    });
    expect(found).toMatchObject({
      id: 'snap-1',
      snapshotWindow: SnapshotWindow.STORY,
      error: 'NOT_ENOUGH_VIEWERS',
      metrics: { views: null, skipRate: null },
    });
  });
});
