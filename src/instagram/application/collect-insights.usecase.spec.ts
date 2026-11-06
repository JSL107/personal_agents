import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InstagramException } from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import {
  NewInsightSnapshot,
  SnapshotError,
  SnapshotWindow,
} from '../domain/instagram-insight.type';
import {
  InstagramPost,
  InstagramPostField,
  InstagramPostStatus,
} from '../domain/instagram-post.type';
import { InstagramInsightSnapshotRepositoryPort } from '../domain/port/instagram-insight-snapshot.repository.port';
import { InstagramPostRepositoryPort } from '../domain/port/instagram-post.repository.port';
import {
  InsightKind,
  MediaInsightsResultKind,
  MetaGraphPort,
} from '../domain/port/meta-graph.port';
import { CollectInsightsUsecase } from './collect-insights.usecase';

const NOW = new Date('2026-11-06T06:00:00Z');
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

// 실제 폴더에 script.json 을 둔다(jest 설정 때문에 모듈 mock 이 먹지 않는다, build-weekly spec 참고).
let reelDir = '';
const post = (patch: Partial<InstagramPost> = {}): InstagramPost =>
  ({
    id: 'post-1',
    reelKey: '2026-11-05/ai',
    field: InstagramPostField.AI,
    videoPath: join(reelDir, 'reel.mp4'),
    mediaId: 'media-1',
    status: InstagramPostStatus.PUBLISHED,
    publishedAt: minutesAgo(1500),
    features: null,
    ...patch,
  }) as InstagramPost;

const metrics = {
  views: 84,
  reach: 71,
  likes: 2,
  comments: 0,
  shares: 0,
  saved: 0,
  totalInteractions: 2,
  reposts: 0,
  replies: null,
  avgWatchMs: 4432,
  totalWatchMs: 323573,
  skipRate: 69.7,
};

const legacyScript = {
  duration: 39.6,
  script: {
    headline: '업데이트 안 하면 위험해요',
    lines: [
      {
        subtitle: '업데이트 안 한 컴퓨터, 일반 계정도 위험?',
        speech: '가나',
        gesture: 'wave',
        react: 'none',
        point_kind: 'none',
      },
    ],
  },
};

describe('CollectInsightsUsecase', () => {
  let posts: jest.Mocked<InstagramPostRepositoryPort>;
  let snapshots: jest.Mocked<InstagramInsightSnapshotRepositoryPort>;
  let graph: jest.Mocked<
    Pick<
      MetaGraphPort,
      'isConfigured' | 'getMediaInsights' | 'getFollowersCount'
    >
  >;
  let usecase: CollectInsightsUsecase;

  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'collect-insights-'));
    reelDir = join(root, '2026-11-05', 'ai');
    mkdirSync(reelDir, { recursive: true });
    writeFileSync(join(reelDir, 'script.json'), JSON.stringify(legacyScript));
    posts = {
      upsertByReelKey: jest.fn(),
      update: jest.fn(),
      findByReelKey: jest.fn(),
      listPublishedSince: jest.fn().mockResolvedValue([post()]),
      setFeatures: jest.fn().mockResolvedValue(undefined),
    };
    snapshots = {
      insertIfAbsent: jest.fn().mockResolvedValue(true),
      listByPostIds: jest.fn().mockResolvedValue([]),
    };
    graph = {
      isConfigured: jest.fn().mockReturnValue(true),
      getMediaInsights: jest.fn().mockResolvedValue({
        kind: MediaInsightsResultKind.OK,
        metrics,
        raw: [],
      }),
      getFollowersCount: jest.fn().mockResolvedValue(2),
    };
    usecase = new CollectInsightsUsecase(
      posts,
      snapshots,
      graph as unknown as MetaGraphPort,
    );
    usecase.now = () => NOW;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const inserted = (): NewInsightSnapshot[] =>
    snapshots.insertIfAbsent.mock.calls.map(([snapshot]) => snapshot);

  it('24시간 지난 릴스의 H24 를 찍고 팔로워 수는 회차에 한 번만 묻는다', async () => {
    posts.listPublishedSince.mockResolvedValue([
      post(),
      post({ id: 'post-2', mediaId: 'media-2' }),
    ]);

    const summary = await usecase.execute();

    expect(posts.listPublishedSince).toHaveBeenCalledWith(minutesAgo(12_960));
    expect(graph.getMediaInsights).toHaveBeenCalledWith({
      mediaId: 'media-1',
      kind: InsightKind.REELS,
    });
    expect(graph.getFollowersCount).toHaveBeenCalledTimes(1);
    expect(inserted()[0]).toMatchObject({
      postId: 'post-1',
      snapshotWindow: SnapshotWindow.AFTER_24_HOURS,
      capturedAt: NOW,
      ageMinutes: 1500,
      metrics,
      followersCount: 2,
      error: null,
    });
    expect(summary).toMatchObject({ inserted: 2, failed: 0 });
  });

  it('이미 찍은 창은 다시 묻지 않는다', async () => {
    snapshots.listByPostIds.mockResolvedValue([
      {
        postId: 'post-1',
        snapshotWindow: SnapshotWindow.AFTER_24_HOURS,
      } as never,
    ]);
    await usecase.execute();
    expect(graph.getMediaInsights).not.toHaveBeenCalled();
  });

  it('script.json 이 없으면 특성 없이 수집만 한다', async () => {
    rmSync(join(reelDir, 'script.json'));
    const summary = await usecase.execute();
    expect(posts.setFeatures).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ featuresFilled: 0, inserted: 1 });
  });

  it('특성이 비어 있으면 script.json 에서 채운다', async () => {
    const summary = await usecase.execute();
    expect(posts.setFeatures.mock.calls[0][0]).toMatchObject({
      id: 'post-1',
      features: { segmentFields: ['ai'], firstLine: { gesture: 'wave' } },
    });
    expect(summary.featuresFilled).toBe(1);
  });

  it('스토리는 특성을 채우지 않고 STORY 종류로 묻는다', async () => {
    posts.listPublishedSince.mockResolvedValue([
      post({ field: InstagramPostField.STORY, publishedAt: minutesAgo(1300) }),
    ]);
    await usecase.execute();
    expect(posts.setFeatures).not.toHaveBeenCalled();
    expect(graph.getMediaInsights).toHaveBeenCalledWith({
      mediaId: 'media-1',
      kind: InsightKind.STORY,
    });
    expect(inserted()[0].snapshotWindow).toBe(
      SnapshotWindow.STORY_BEFORE_EXPIRY,
    );
  });

  it('조회 5 미만이면 지표 없이 NOT_ENOUGH_VIEWERS 행을 남긴다', async () => {
    graph.getMediaInsights.mockResolvedValue({
      kind: MediaInsightsResultKind.NOT_ENOUGH_VIEWERS,
      raw: { code: 10 },
    });
    await usecase.execute();
    expect(inserted()[0].error).toBe(SnapshotError.NOT_ENOUGH_VIEWERS);
    expect(Object.values(inserted()[0].metrics).every((v) => v === null)).toBe(
      true,
    );
  });

  it('한 건이 실패하면 그 건만 건너뛰고 다음 건을 계속한다', async () => {
    posts.listPublishedSince.mockResolvedValue([
      post(),
      post({ id: 'post-2', mediaId: 'media-2' }),
    ]);
    graph.getMediaInsights
      .mockRejectedValueOnce(
        new InstagramException({
          code: InstagramErrorCode.GRAPH_REQUEST_FAILED,
          message: 'boom',
        }),
      )
      .mockResolvedValueOnce({
        kind: MediaInsightsResultKind.OK,
        metrics,
        raw: [],
      });

    const summary = await usecase.execute();

    expect(inserted().map((snapshot) => snapshot.postId)).toEqual(['post-2']);
    expect(summary).toMatchObject({ inserted: 1, failed: 1 });
  });

  it('토큰이 무효면 남은 건을 멈추고 실패 한 건으로 센다', async () => {
    posts.listPublishedSince.mockResolvedValue([
      post(),
      post({ id: 'post-2', mediaId: 'media-2' }),
    ]);
    graph.getMediaInsights.mockRejectedValue(
      new InstagramException({
        code: InstagramErrorCode.TOKEN_INVALID,
        message: 'expired',
      }),
    );
    await expect(usecase.execute()).resolves.toMatchObject({
      inserted: 0,
      failed: 1,
    });
    expect(graph.getMediaInsights).toHaveBeenCalledTimes(1);
  });

  it('이미 있는 창(P2002)은 오류가 아니라 건너뜀으로 센다', async () => {
    snapshots.insertIfAbsent.mockResolvedValue(false);
    await expect(usecase.execute()).resolves.toMatchObject({
      inserted: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it('팔로워 수를 못 읽어도 null 로 계속한다', async () => {
    graph.getFollowersCount.mockRejectedValue(new Error('down'));
    await usecase.execute();
    expect(inserted()[0].followersCount).toBeNull();
  });

  it('인스타 설정이 꺼져 있으면 아무것도 묻지 않는다', async () => {
    graph.isConfigured.mockReturnValue(false);
    await expect(usecase.execute()).resolves.toEqual({
      inserted: 0,
      skipped: 0,
      failed: 0,
      featuresFilled: 0,
    });
    expect(posts.listPublishedSince).not.toHaveBeenCalled();
  });
});
