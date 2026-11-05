import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import {
  InstagramPost,
  InstagramPostStatus,
} from '../domain/instagram-post.type';
import { InstagramPostRepositoryPort } from '../domain/port/instagram-post.repository.port';
import {
  ContainerStatusCode,
  MetaGraphPort,
} from '../domain/port/meta-graph.port';
import {
  PublishStoryInput,
  PublishStoryUsecase,
  STORY_UNCONFIRMED_PREFIX,
} from './publish-story.usecase';

const video = Buffer.from('story');
const directory = mkdtempSync(join(tmpdir(), 'publish-story-'));
const storyPath = join(directory, 'story.mp4');
const story = {
  videoPath: storyPath,
  videoSha256: createHash('sha256').update(video).digest('hex'),
  videoBytes: 5,
};
const input: PublishStoryInput = {
  day: '2026-11-06',
  reelPreviewId: 'card',
  story,
  isLastSlot: false,
};
const post = (): InstagramPost => ({
  id: 'post',
  reelKey: '2026-11-06/story',
  field: 'story',
  title: '오늘의 한 줄 스토리',
  videoPath: story.videoPath,
  videoSha256: story.videoSha256,
  caption: '',
  previewActionId: 'card',
  containerId: null,
  containerCreatedAt: null,
  uploadedAt: null,
  publishAttemptedAt: null,
  mediaId: null,
  permalink: null,
  status: InstagramPostStatus.PENDING,
  lastError: null,
  publishedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});
const status = (statusCode: ContainerStatusCode) => ({
  statusCode,
  status: null,
});

describe('PublishStoryUsecase', () => {
  let row: InstagramPost;
  let repository: jest.Mocked<InstagramPostRepositoryPort>;
  let graph: jest.Mocked<MetaGraphPort>;
  let lease: { acquireOnce: jest.Mock; release: jest.Mock };
  let usecase: PublishStoryUsecase;

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    writeFileSync(storyPath, video);
    row = post();
    repository = {
      upsertByReelKey: jest.fn(async (claim) => {
        void claim;
        return row;
      }),
      update: jest.fn(async ({ patch }) => {
        row = { ...row, ...patch } as InstagramPost;
        return row;
      }),
      findByReelKey: jest.fn(async (reelKey) => {
        void reelKey;
        return row;
      }),
    };
    graph = {
      isConfigured: jest.fn().mockReturnValue(true),
      getPublishingLimit: jest.fn().mockResolvedValue({ usage: 0, total: 100 }),
      createReelContainer: jest.fn(),
      createStoryContainer: jest
        .fn()
        .mockResolvedValue({ containerId: 'container', uploadUri: 'uri' }),
      uploadVideo: jest.fn().mockResolvedValue(undefined),
      getContainerStatus: jest
        .fn()
        .mockResolvedValue(status(ContainerStatusCode.FINISHED)),
      publish: jest
        .fn()
        .mockResolvedValue({ mediaId: 'media', configIssue: null }),
      getMedia: jest.fn().mockResolvedValue({
        permalink: 'https://instagram.com/stories/x',
        timestamp: '2026-11-06T00:00:00Z',
      }),
      listRecentMedia: jest.fn(),
      debugPageToken: jest.fn(),
    };
    lease = {
      acquireOnce: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    };
    usecase = new PublishStoryUsecase(
      repository,
      graph,
      lease as unknown as CronIdempotencyService,
    );
    usecase.pollIntervalMs = 0;
  });

  it('임대를 못 잡으면 Meta 를 부르지 않고 locked', async () => {
    lease.acquireOnce.mockResolvedValue(false);

    await expect(usecase.execute(input)).resolves.toEqual({ kind: 'locked' });

    expect(repository.upsertByReelKey).not.toHaveBeenCalled();
    expect(lease.acquireOnce).toHaveBeenCalledWith(
      'instagram-story:2026-11-06',
      900,
    );
  });

  it('컨테이너 생성 → 업로드 → FINISHED → 게시 → PUBLISHED 로 한 번 올린다', async () => {
    await expect(usecase.execute(input)).resolves.toEqual({
      kind: 'published',
    });

    expect(repository.upsertByReelKey).toHaveBeenCalledWith(
      expect.objectContaining({
        reelKey: '2026-11-06/story',
        field: 'story',
        caption: '',
        previewActionId: 'card',
      }),
    );
    expect(graph.createStoryContainer).toHaveBeenCalledTimes(1);
    expect(graph.uploadVideo).toHaveBeenCalledWith({ uploadUri: 'uri', video });
    expect(graph.publish).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({
      status: InstagramPostStatus.PUBLISHED,
      mediaId: 'media',
      permalink: 'https://instagram.com/stories/x',
      lastError: null,
    });
    expect(lease.release).toHaveBeenCalledWith('instagram-story:2026-11-06');
  });

  it('게시 시도 기록이 있으면 컨테이너가 FINISHED 여도 다시 publish 하지 않는다', async () => {
    row = {
      ...post(),
      containerId: 'container',
      uploadedAt: new Date(),
      publishAttemptedAt: new Date(Date.now() - 60 * 60_000),
      status: InstagramPostStatus.PUBLISHING,
    };

    await expect(usecase.execute(input)).resolves.toEqual({
      kind: 'pending',
      reason: '게시 확인 대기(컨테이너 FINISHED)',
    });

    expect(graph.publish).not.toHaveBeenCalled();
    expect(graph.createStoryContainer).not.toHaveBeenCalled();
  });

  it('마지막 슬롯까지 확정되지 않으면 확인 필요로 종결하고, 다음 호출은 Meta 를 부르지 않는다', async () => {
    row = {
      ...post(),
      containerId: 'container',
      uploadedAt: new Date(),
      publishAttemptedAt: new Date(),
      status: InstagramPostStatus.PUBLISHING,
    };

    await expect(
      usecase.execute({ ...input, isLastSlot: true }),
    ).resolves.toEqual({ kind: 'unconfirmed' });
    expect(row.lastError?.startsWith(STORY_UNCONFIRMED_PREFIX)).toBe(true);

    graph.getContainerStatus.mockClear();
    await expect(usecase.execute(input)).resolves.toEqual({ kind: 'done' });
    expect(graph.getContainerStatus).not.toHaveBeenCalled();
    expect(graph.publish).not.toHaveBeenCalled();
  });

  it('마지막 슬롯에서 상태 조회가 실패해도 확인 필요로 종결한다', async () => {
    row = {
      ...post(),
      containerId: 'container',
      uploadedAt: new Date(),
      publishAttemptedAt: new Date(),
      status: InstagramPostStatus.PUBLISHING,
    };
    graph.getContainerStatus.mockRejectedValue(new Error('Graph timeout'));

    await expect(
      usecase.execute({ ...input, isLastSlot: true }),
    ).resolves.toEqual({ kind: 'unconfirmed' });
    expect(row.lastError).toContain('조회 실패(Graph timeout)');
    expect(graph.publish).not.toHaveBeenCalled();
  });

  it('게시 시도 뒤 컨테이너가 PUBLISHED 면 mediaId 없이도 확정한다', async () => {
    row = {
      ...post(),
      containerId: 'container',
      uploadedAt: new Date(),
      publishAttemptedAt: new Date(),
      status: InstagramPostStatus.PUBLISHING,
    };
    graph.getContainerStatus.mockResolvedValue(
      status(ContainerStatusCode.PUBLISHED),
    );

    await expect(usecase.execute(input)).resolves.toEqual({
      kind: 'published',
    });
    expect(row).toMatchObject({
      status: InstagramPostStatus.PUBLISHED,
      mediaId: null,
      permalink: null,
    });
    expect(graph.getMedia).not.toHaveBeenCalled();
  });

  it('publish 응답이 실패하면 게시 시도를 남기고 pending, 다음 호출도 다시 publish 하지 않는다', async () => {
    graph.publish.mockRejectedValue(new Error('timeout'));

    await expect(usecase.execute(input)).resolves.toEqual({
      kind: 'pending',
      reason: '게시 응답 없음: timeout',
    });
    expect(row.publishAttemptedAt).toBeInstanceOf(Date);

    await usecase.execute(input);
    expect(graph.publish).toHaveBeenCalledTimes(1);
  });

  it('마지막 슬롯에서 publish 응답을 못 받으면 바로 확인 필요로 종결한다', async () => {
    graph.publish.mockRejectedValue(new Error('timeout'));

    await expect(
      usecase.execute({ ...input, isLastSlot: true }),
    ).resolves.toEqual({ kind: 'unconfirmed' });
    expect(row.lastError?.startsWith(STORY_UNCONFIRMED_PREFIX)).toBe(true);
  });

  it('승인 뒤 파일이 바뀌면 컨테이너를 만들지 않고 failed', async () => {
    writeFileSync(storyPath, 'changed');

    await expect(usecase.execute(input)).resolves.toEqual({
      kind: 'failed',
      reason: '스토리 영상이 변경되었습니다',
    });
    expect(graph.createStoryContainer).not.toHaveBeenCalled();
    expect(row.lastError).toBe('스토리 영상이 변경되었습니다');
  });

  it('Meta 오류는 throw 하지 않고 failed 로 돌려주며 임대를 푼다', async () => {
    graph.createStoryContainer.mockRejectedValue(new Error('Graph 500'));

    await expect(usecase.execute(input)).resolves.toEqual({
      kind: 'failed',
      reason: 'Graph 500',
    });
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it('게시 시도 전 컨테이너가 EXPIRED 면 새 컨테이너로 다시 올린다', async () => {
    row = { ...post(), containerId: 'old', uploadedAt: new Date() };
    graph.getContainerStatus
      .mockResolvedValueOnce(status(ContainerStatusCode.EXPIRED))
      .mockResolvedValue(status(ContainerStatusCode.FINISHED));

    await expect(usecase.execute(input)).resolves.toEqual({
      kind: 'published',
    });
    expect(graph.createStoryContainer).toHaveBeenCalledTimes(1);
    expect(row.containerId).toBe('container');
  });

  it('처리가 끝나지 않으면 게시하지 않고 pending, 다음 호출은 같은 컨테이너를 이어 본다', async () => {
    graph.getContainerStatus.mockResolvedValue(
      status(ContainerStatusCode.IN_PROGRESS),
    );

    await expect(usecase.execute(input)).resolves.toEqual({
      kind: 'pending',
      reason: '인스타가 아직 스토리 영상을 처리 중',
    });
    await usecase.execute(input);

    expect(graph.createStoryContainer).toHaveBeenCalledTimes(1);
    expect(graph.publish).not.toHaveBeenCalled();
  });

  it('이미 PUBLISHED 면 아무것도 부르지 않는다', async () => {
    row = { ...post(), status: InstagramPostStatus.PUBLISHED };

    await expect(usecase.execute(input)).resolves.toEqual({
      kind: 'done',
    });
    expect(graph.getContainerStatus).not.toHaveBeenCalled();
  });
});
