import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

import { PreviewAction } from '../../preview-gate/domain/preview-action.type';
import { InstagramException } from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import { InstagramPost } from '../domain/instagram-post.type';
import { InstagramPostRepositoryPort } from '../domain/port/instagram-post.repository.port';
import { MetaGraphPort } from '../domain/port/meta-graph.port';
import { InstagramReelPublishApplier } from './instagram-reel-publish.applier';

jest.mock('fs/promises', () => ({ readFile: jest.fn() }));

const video = Buffer.from('video');
const payload = {
  reelKey: '2026-11-05/ai',
  field: 'ai',
  title: 'title',
  videoPath: '/video',
  videoSha256: createHash('sha256').update(video).digest('hex'),
  videoBytes: 5,
  caption: 'caption',
  durationSec: 10,
};
const preview = { id: 'card', payload } as PreviewAction;
const post = (): InstagramPost => ({
  ...payload,
  field: 'ai',
  previewActionId: 'card',
  id: 'post',
  containerId: null,
  containerCreatedAt: null,
  uploadedAt: null,
  publishAttemptedAt: null,
  mediaId: null,
  permalink: null,
  status: 'PENDING',
  lastError: null,
  publishedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('InstagramReelPublishApplier', () => {
  let row: InstagramPost;
  let repository: jest.Mocked<InstagramPostRepositoryPort>;
  let graph: jest.Mocked<MetaGraphPort>;
  let applier: InstagramReelPublishApplier;
  beforeEach(() => {
    jest.clearAllMocks();
    row = post();
    repository = {
      claim: jest.fn(async (input) => {
        if (
          input.previewActionId !== row.previewActionId &&
          row.status !== 'PUBLISHED'
        ) {
          throw new InstagramException({
            code: InstagramErrorCode.REEL_CLAIMED,
            message: 'claimed',
          });
        }
        return row;
      }),
      update: jest.fn(async (_id, patch) => {
        row = { ...row, ...patch } as InstagramPost;
        return row;
      }),
      findByReelKey: jest.fn(),
    };
    graph = {
      isConfigured: jest.fn().mockReturnValue(true),
      getPublishingLimit: jest.fn().mockResolvedValue({ usage: 0, total: 100 }),
      createReelContainer: jest
        .fn()
        .mockResolvedValue({ containerId: 'container', uploadUri: 'uri' }),
      uploadVideo: jest.fn().mockResolvedValue(undefined),
      getContainerStatus: jest
        .fn()
        .mockResolvedValue({ statusCode: 'FINISHED', status: null }),
      publish: jest
        .fn()
        .mockResolvedValue({ mediaId: 'media', configIssue: null }),
      getMedia: jest.fn().mockResolvedValue({
        permalink: 'link',
        timestamp: '2026-11-05T00:00:00Z',
      }),
      listRecentMedia: jest.fn().mockResolvedValue([]),
      debugPageToken: jest.fn(),
    };
    jest.mocked(readFile).mockResolvedValue(video as never);
    applier = new InstagramReelPublishApplier(repository, graph);
    applier.pollIntervalMs = 0;
    applier.settleIntervalMs = 0;
  });
  it('게시가 꺼져 있으면 파싱과 선점 전에 중단한다', async () => {
    graph.isConfigured.mockReturnValue(false);
    await expect(
      applier.apply({ ...preview, payload: null }),
    ).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_DISABLED',
      message: '인스타 게시가 꺼져 있습니다(INSTAGRAM_PUBLISH_ENABLED)',
    });
    expect(repository.claim).not.toHaveBeenCalled();
    expect(graph.getPublishingLimit).not.toHaveBeenCalled();
  });
  it('happy path', async () => {
    graph.getContainerStatus.mockResolvedValueOnce({
      statusCode: 'IN_PROGRESS',
      status: null,
    });
    const result = await applier.apply(preview);
    expect(result.message).toContain('link');
    expect(row.status).toBe('PUBLISHED');
    expect(
      repository.update.mock.invocationCallOrder.find(
        (_, index) =>
          repository.update.mock.calls[index][1].publishAttemptedAt instanceof
          Date,
      ),
    ).toBeLessThan(graph.publish.mock.invocationCallOrder[0]);
  });
  it('concurrent two cards', async () => {
    const results = await Promise.allSettled([
      applier.apply(preview),
      applier.apply({ ...preview, id: 'other' }),
    ]);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(graph.createReelContainer).toHaveBeenCalledTimes(1);
  });
  it('settle before file check', async () => {
    row = {
      ...row,
      status: 'PUBLISHING',
      containerId: 'container',
      containerCreatedAt: new Date('2026-11-01'),
      publishAttemptedAt: new Date(),
    };
    graph.getContainerStatus.mockResolvedValue({
      statusCode: 'PUBLISHED',
      status: null,
    });
    graph.listRecentMedia.mockResolvedValue([
      {
        id: 'media',
        caption: 'caption',
        permalink: 'link',
        timestamp: '2026-11-05T00:00:00Z',
      },
    ]);
    jest.mocked(readFile).mockRejectedValue(new Error('missing') as never);
    await applier.apply(preview);
    expect(row.status).toBe('PUBLISHED');
    expect(readFile).not.toHaveBeenCalled();
  });
  it('publish lost and still finished', async () => {
    graph.publish.mockRejectedValue(new Error('lost'));
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_UNCONFIRMED',
    });
    expect(graph.publish).toHaveBeenCalledTimes(1);
  });
  it('게시 후 원장 저장에 실패하면 기록 미완료를 알린다', async () => {
    repository.update.mockImplementation(async (_id, patch) => {
      if (patch.mediaId) {
        throw new Error('db failed');
      }
      row = { ...row, ...patch } as InstagramPost;
      return row;
    });
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_UNCONFIRMED',
      message:
        '인스타에는 올라갔지만 기록을 마치지 못했습니다. 잠시 뒤 다시 누르면 올라간 게시물을 찾아 기록합니다',
    });
    expect(graph.listRecentMedia).not.toHaveBeenCalled();
    expect(graph.getContainerStatus).toHaveBeenCalledTimes(1);
  });
  it('게시 후 상세 조회에 실패하면 기록 미완료를 알린다', async () => {
    graph.getMedia.mockRejectedValue(new Error('failed'));
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_UNCONFIRMED',
      message:
        '인스타에는 올라갔지만 기록을 마치지 못했습니다. 잠시 뒤 다시 누르면 올라간 게시물을 찾아 기록합니다',
    });
  });
  it('게시 후 마감 기록에 실패하면 기록 미완료를 알린다', async () => {
    repository.update.mockImplementation(async (_id, patch) => {
      if (patch.status === 'PUBLISHED') {
        throw new Error('failed');
      }
      row = { ...row, ...patch } as InstagramPost;
      return row;
    });
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_UNCONFIRMED',
      message:
        '인스타에는 올라갔지만 기록을 마치지 못했습니다. 잠시 뒤 다시 누르면 올라간 게시물을 찾아 기록합니다',
    });
  });
  it('publish failure preserves graph error detail when unconfirmed', async () => {
    graph.publish.mockRejectedValue(
      new InstagramException({
        code: InstagramErrorCode.GRAPH_REQUEST_FAILED,
        message: 'Meta 오류 25/2207050: 제한',
      }),
    );
    await expect(applier.apply(preview)).rejects.toThrow('2207050');
    expect(row.lastError).toContain('2207050');
  });
  it('초 단위 게시 시각이 컨테이너 생성 시각과 같으면 일치한다', async () => {
    row = {
      ...row,
      containerId: 'container',
      containerCreatedAt: new Date('2026-11-05T12:00:00.700Z'),
    };
    graph.getContainerStatus.mockResolvedValue({
      statusCode: 'PUBLISHED',
      status: null,
    });
    graph.listRecentMedia.mockResolvedValue([
      {
        id: 'media',
        caption: 'caption',
        permalink: 'link',
        timestamp: '2026-11-05T12:00:00+0000',
      },
    ]);
    await expect(applier.apply(preview)).resolves.toMatchObject({
      message: expect.stringContaining('link'),
    });
  });
  it('Graph의 콜론 없는 시간대 표기를 날짜로 파싱한다', () => {
    expect(new Date('2026-11-05T12:00:00+0000').toISOString()).toBe(
      '2026-11-05T12:00:00.000Z',
    );
  });
  it('캡션의 줄 끝 공백과 CRLF 차이를 무시하고 대조한다', async () => {
    row = {
      ...row,
      containerId: 'container',
      containerCreatedAt: new Date('2026-11-01'),
    };
    graph.getContainerStatus.mockResolvedValue({
      statusCode: 'PUBLISHED',
      status: null,
    });
    graph.listRecentMedia.mockResolvedValue([
      {
        id: 'media',
        caption: 'cafe\u0301  text  \r\nsecond ',
        permalink: 'link',
        timestamp: '2026-11-05T12:00:00Z',
      },
    ]);
    await expect(
      applier.apply({
        ...preview,
        payload: { ...payload, caption: 'café text\nsecond' },
      }),
    ).resolves.toMatchObject({ message: expect.stringContaining('link') });
  });
  it('reconcile ambiguous', async () => {
    row = {
      ...row,
      containerId: 'container',
      containerCreatedAt: new Date('2026-11-01'),
      publishAttemptedAt: new Date(),
    };
    graph.getContainerStatus.mockResolvedValue({
      statusCode: 'PUBLISHED',
      status: null,
    });
    graph.listRecentMedia.mockResolvedValue([
      {
        id: '1',
        caption: 'caption',
        permalink: 'link',
        timestamp: '2026-11-05T00:00:00Z',
      },
      {
        id: '2',
        caption: 'caption',
        permalink: 'link2',
        timestamp: '2026-11-05T00:00:00Z',
      },
    ]);
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_UNCONFIRMED',
    });
  });
  it('already published', async () => {
    row = { ...row, status: 'PUBLISHED', permalink: 'old' };
    expect((await applier.apply(preview)).message).toContain('old');
    expect(graph.getPublishingLimit).not.toHaveBeenCalled();
  });
  it('claimed by other card', async () => {
    await expect(
      applier.apply({ ...preview, id: 'other' }),
    ).rejects.toMatchObject({ errorCode: 'INSTAGRAM_REEL_CLAIMED' });
    expect(graph.createReelContainer).not.toHaveBeenCalled();
  });
  it('lastError persistence failure still throws InstagramException', async () => {
    jest.mocked(readFile).mockRejectedValue(new Error('missing') as never);
    repository.update.mockRejectedValue(new Error('db failed'));
    await expect(applier.apply(preview)).rejects.toBeInstanceOf(
      InstagramException,
    );
  });
  it('file missing', async () => {
    jest.mocked(readFile).mockRejectedValue(new Error('missing') as never);
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_VIDEO_MISSING',
    });
    expect(graph.getPublishingLimit).not.toHaveBeenCalled();
  });
  it('video changed', async () => {
    jest.mocked(readFile).mockResolvedValue(Buffer.from('changed') as never);
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_VIDEO_CHANGED',
    });
    expect(graph.getPublishingLimit).not.toHaveBeenCalled();
  });
  it('quota', async () => {
    graph.getPublishingLimit.mockResolvedValue({ usage: 100, total: 100 });
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_QUOTA_EXCEEDED',
    });
    expect(graph.createReelContainer).not.toHaveBeenCalled();
  });
  it('resume after upload', async () => {
    row = {
      ...row,
      containerId: 'container',
      containerCreatedAt: new Date(),
      uploadedAt: new Date(),
    };
    await applier.apply(preview);
    expect(graph.createReelContainer).not.toHaveBeenCalled();
    expect(graph.publish).toHaveBeenCalledTimes(1);
  });
  it('resume container expired before publish', async () => {
    row = { ...row, containerId: 'old', uploadedAt: new Date() };
    graph.getContainerStatus.mockResolvedValueOnce({
      statusCode: 'EXPIRED',
      status: null,
    });
    await applier.apply(preview);
    expect(graph.createReelContainer).toHaveBeenCalledTimes(1);
  });
  it('publish lost then published', async () => {
    graph.publish.mockRejectedValue(new Error('lost'));
    graph.getContainerStatus
      .mockResolvedValueOnce({ statusCode: 'FINISHED', status: null })
      .mockResolvedValue({ statusCode: 'PUBLISHED', status: null });
    graph.listRecentMedia.mockImplementation(async () => [
      {
        id: 'media',
        caption: 'caption',
        permalink: 'link',
        timestamp: new Date(Date.now() + 1000).toISOString(),
      },
    ]);
    await applier.apply(preview);
    expect(row.status).toBe('PUBLISHED');
    expect(graph.publish).toHaveBeenCalledTimes(1);
  });
  it('retry after unconfirmed', async () => {
    row = {
      ...row,
      status: 'PUBLISHING',
      containerId: 'container',
      containerCreatedAt: new Date(Date.now() - 11 * 60_000),
      uploadedAt: new Date(Date.now() - 11 * 60_000),
      publishAttemptedAt: new Date(Date.now() - 11 * 60_000),
    };
    await applier.apply(preview);
    expect(graph.createReelContainer).not.toHaveBeenCalled();
    expect(graph.publish).toHaveBeenCalledTimes(1);
  });
  it('게시 결과가 불확실한 뒤 10분 안에 다시 누르면 재게시하지 않는다', async () => {
    graph.publish.mockRejectedValueOnce(new Error('lost'));
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_UNCONFIRMED',
    });
    expect(graph.publish).toHaveBeenCalledTimes(1);

    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_UNCONFIRMED',
    });
    expect(graph.publish).toHaveBeenCalledTimes(1);
    expect(graph.createReelContainer).toHaveBeenCalledTimes(1);
  });
  it('게시 결과가 불확실한 뒤 10분이 지나면 같은 컨테이너로 한 번 재시도한다', async () => {
    graph.publish.mockRejectedValueOnce(new Error('lost'));
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_UNCONFIRMED',
    });
    row = { ...row, publishAttemptedAt: new Date(Date.now() - 11 * 60_000) };

    await applier.apply(preview);
    expect(graph.publish).toHaveBeenCalledTimes(2);
    expect(graph.publish).toHaveBeenLastCalledWith('container');
    expect(graph.createReelContainer).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('PUBLISHED');
  });
  it('publish attempt without a container fails closed', async () => {
    row = {
      ...row,
      status: 'PUBLISHING',
      containerId: null,
      publishAttemptedAt: new Date(),
    };
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_UNCONFIRMED',
    });
    expect(graph.createReelContainer).not.toHaveBeenCalled();
  });
  it('publish attempt never replaces a container without upload timestamp', async () => {
    row = {
      ...row,
      status: 'PUBLISHING',
      containerId: 'container',
      containerCreatedAt: new Date(Date.now() - 11 * 60_000),
      uploadedAt: null,
      publishAttemptedAt: new Date(Date.now() - 11 * 60_000),
    };
    await applier.apply(preview);
    expect(graph.createReelContainer).not.toHaveBeenCalled();
    expect(graph.publish).toHaveBeenCalledWith('container');
  });
  it('published during polling is reconciled without publishing again', async () => {
    graph.getContainerStatus.mockResolvedValue({
      statusCode: 'PUBLISHED',
      status: null,
    });
    graph.listRecentMedia.mockImplementation(async () => [
      {
        id: 'media',
        caption: 'caption',
        permalink: 'link',
        timestamp: new Date(Date.now() + 1000).toISOString(),
      },
    ]);
    await applier.apply(preview);
    expect(row.status).toBe('PUBLISHED');
    expect(graph.publish).not.toHaveBeenCalled();
  });
  it('processing timeout', async () => {
    graph.getContainerStatus.mockResolvedValue({
      statusCode: 'IN_PROGRESS',
      status: null,
    });
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PROCESSING_TIMEOUT',
    });
    expect(graph.getContainerStatus).toHaveBeenCalledTimes(5);
    expect(row.containerId).toBe('container');
  });
  it('container error', async () => {
    graph.getContainerStatus.mockResolvedValue({
      statusCode: 'ERROR',
      status: 'subcode 42',
    });
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_CONTAINER_FAILED',
    });
    expect(row.lastError).toContain('subcode 42');
  });
  it('token 190', async () => {
    graph.publish.mockRejectedValue(
      new InstagramException({
        code: InstagramErrorCode.TOKEN_INVALID,
        message: 'invalid',
      }),
    );
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_TOKEN_INVALID',
    });
    expect(row.lastError).toContain('INSTAGRAM_TOKEN_INVALID');
  });
  it('config_issue', async () => {
    graph.publish.mockResolvedValue({
      mediaId: 'media',
      configIssue: 'warning',
    });
    expect((await applier.apply(preview)).message).toContain('주의: warning');
  });
});
