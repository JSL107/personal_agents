import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

import { PreviewAction } from '../../preview-gate/domain/preview-action.type';
import { InstagramException } from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
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
  InstagramReelPublishApplier,
  isSamePost,
} from './instagram-reel-publish.applier';

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
  status: InstagramPostStatus.PENDING,
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
      upsertByReelKey: jest.fn(async (input) => {
        void input;
        return row;
      }),
      update: jest.fn(async ({ patch }) => {
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
      getContainerStatus: jest.fn().mockResolvedValue({
        statusCode: ContainerStatusCode.FINISHED,
        status: null,
      }),
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
    expect(repository.upsertByReelKey).not.toHaveBeenCalled();
    expect(graph.getPublishingLimit).not.toHaveBeenCalled();
  });
  it('정상 릴스를 게시하고 결과를 기록한다', async () => {
    graph.getContainerStatus.mockResolvedValueOnce({
      statusCode: ContainerStatusCode.IN_PROGRESS,
      status: null,
    });
    const result = await applier.apply(preview);
    expect(result.message).toContain('link');
    expect(row.status).toBe('PUBLISHED');
    expect(
      repository.update.mock.invocationCallOrder.find(
        (_, index) =>
          repository.update.mock.calls[index][0].patch
            .publishAttemptedAt instanceof Date,
      ),
    ).toBeLessThan(graph.publish.mock.invocationCallOrder[0]);
  });
  it('같은 릴스의 다른 카드 두 장을 동시에 승인하면 컨테이너는 하나만 만든다', async () => {
    const results = await Promise.allSettled([
      applier.apply(preview),
      applier.apply({ ...preview, id: 'other' }),
    ]);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(graph.createReelContainer).toHaveBeenCalledTimes(1);
  });
  it('게시 시도 기록이 있으면 파일 검사보다 정산을 먼저 한다', async () => {
    row = {
      ...row,
      status: InstagramPostStatus.PUBLISHING,
      containerId: 'container',
      containerCreatedAt: new Date('2026-11-01'),
      publishAttemptedAt: new Date(),
    };
    graph.getContainerStatus.mockResolvedValue({
      statusCode: ContainerStatusCode.PUBLISHED,
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
  it('게시 응답을 잃고 상태가 계속 FINISHED 면 재게시하지 않고 확인을 요청한다', async () => {
    graph.publish.mockRejectedValue(new Error('lost'));
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_UNCONFIRMED',
    });
    expect(graph.publish).toHaveBeenCalledTimes(1);
  });
  it('게시 후 원장 저장에 실패하면 기록 미완료를 알린다', async () => {
    repository.update.mockImplementation(async ({ patch }) => {
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
    repository.update.mockImplementation(async ({ patch }) => {
      if (patch.status === InstagramPostStatus.PUBLISHED) {
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
  it('게시가 미확정이면 Graph 오류 상세를 보존한다', async () => {
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
      statusCode: ContainerStatusCode.PUBLISHED,
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
      statusCode: ContainerStatusCode.PUBLISHED,
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
  it('같은 캡션 게시물이 두 건이면 자동으로 확정하지 않는다', async () => {
    row = {
      ...row,
      containerId: 'container',
      containerCreatedAt: new Date('2026-11-01'),
      publishAttemptedAt: new Date(),
    };
    graph.getContainerStatus.mockResolvedValue({
      statusCode: ContainerStatusCode.PUBLISHED,
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
  it('이미 게시된 릴스는 기존 링크를 반환한다', async () => {
    row = { ...row, status: InstagramPostStatus.PUBLISHED, permalink: 'old' };
    expect((await applier.apply(preview)).message).toContain('old');
    expect(graph.getPublishingLimit).not.toHaveBeenCalled();
  });
  it('다른 카드가 선점한 릴스는 게시하지 않는다', async () => {
    await expect(
      applier.apply({ ...preview, id: 'other' }),
    ).rejects.toMatchObject({ errorCode: 'INSTAGRAM_REEL_CLAIMED' });
    expect(graph.createReelContainer).not.toHaveBeenCalled();
  });
  it('오류 기록이 실패해도 InstagramException을 던진다', async () => {
    jest.mocked(readFile).mockRejectedValue(new Error('missing') as never);
    repository.update.mockRejectedValue(new Error('db failed'));
    await expect(applier.apply(preview)).rejects.toBeInstanceOf(
      InstagramException,
    );
  });
  it('영상 파일이 없으면 실패한다', async () => {
    jest.mocked(readFile).mockRejectedValue(new Error('missing') as never);
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_VIDEO_MISSING',
    });
    expect(graph.getPublishingLimit).not.toHaveBeenCalled();
  });
  it('영상이 변경되면 실패한다', async () => {
    jest.mocked(readFile).mockResolvedValue(Buffer.from('changed') as never);
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_VIDEO_CHANGED',
    });
    expect(graph.getPublishingLimit).not.toHaveBeenCalled();
  });
  it('게시 한도를 초과하면 실패한다', async () => {
    graph.getPublishingLimit.mockResolvedValue({ usage: 100, total: 100 });
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_QUOTA_EXCEEDED',
    });
    expect(graph.createReelContainer).not.toHaveBeenCalled();
  });
  it('업로드된 컨테이너로 게시를 재개한다', async () => {
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
  it('만료된 컨테이너는 새로 만들어 게시한다', async () => {
    row = { ...row, containerId: 'old', uploadedAt: new Date() };
    graph.getContainerStatus.mockResolvedValueOnce({
      statusCode: ContainerStatusCode.EXPIRED,
      status: null,
    });
    await applier.apply(preview);
    expect(graph.createReelContainer).toHaveBeenCalledTimes(1);
  });
  it('게시 응답을 잃어도 게시 상태면 결과를 정산한다', async () => {
    graph.publish.mockRejectedValue(new Error('lost'));
    graph.getContainerStatus
      .mockResolvedValueOnce({
        statusCode: ContainerStatusCode.FINISHED,
        status: null,
      })
      .mockResolvedValue({
        statusCode: ContainerStatusCode.PUBLISHED,
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
    expect(graph.publish).toHaveBeenCalledTimes(1);
  });
  it('게시 결과가 미확정이면 재시도 시 확인을 요청한다', async () => {
    row = {
      ...row,
      status: InstagramPostStatus.PUBLISHING,
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
  it('게시 시도에 컨테이너가 없으면 중단한다', async () => {
    row = {
      ...row,
      status: InstagramPostStatus.PUBLISHING,
      containerId: null,
      publishAttemptedAt: new Date(),
    };
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PUBLISH_UNCONFIRMED',
    });
    expect(graph.createReelContainer).not.toHaveBeenCalled();
  });
  it('게시 시도 뒤에는 업로드 시각이 없어도 컨테이너를 교체하지 않는다', async () => {
    row = {
      ...row,
      status: InstagramPostStatus.PUBLISHING,
      containerId: 'container',
      containerCreatedAt: new Date(Date.now() - 11 * 60_000),
      uploadedAt: null,
      publishAttemptedAt: new Date(Date.now() - 11 * 60_000),
    };
    await applier.apply(preview);
    expect(graph.createReelContainer).not.toHaveBeenCalled();
    expect(graph.publish).toHaveBeenCalledWith('container');
  });
  it('폴링 중 게시가 확인되면 재게시 없이 정산한다', async () => {
    graph.getContainerStatus.mockResolvedValue({
      statusCode: ContainerStatusCode.PUBLISHED,
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
  it('영상 처리 시간이 초과되면 실패한다', async () => {
    graph.getContainerStatus.mockResolvedValue({
      statusCode: ContainerStatusCode.IN_PROGRESS,
      status: null,
    });
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_PROCESSING_TIMEOUT',
    });
    expect(graph.getContainerStatus).toHaveBeenCalledTimes(5);
    expect(row.containerId).toBe('container');
  });
  it('컨테이너 오류가 발생하면 실패한다', async () => {
    graph.getContainerStatus.mockResolvedValue({
      statusCode: ContainerStatusCode.ERROR,
      status: 'subcode 42',
    });
    await expect(applier.apply(preview)).rejects.toMatchObject({
      errorCode: 'INSTAGRAM_CONTAINER_FAILED',
    });
    expect(row.lastError).toContain('subcode 42');
  });
  it('토큰 오류를 그대로 전달한다', async () => {
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
  it('설정 문제가 있으면 결과에 주의를 표시한다', async () => {
    graph.publish.mockResolvedValue({
      mediaId: 'media',
      configIssue: 'warning',
    });
    expect((await applier.apply(preview)).message).toContain('주의: warning');
  });
});

describe('isSamePost', () => {
  it('캡션과 기준 시각이 일치하면 같은 게시물로 판정한다', () => {
    const item = {
      id: 'id',
      permalink: 'link',
      caption: '한글\r\n문장 ',
      timestamp: '2026-11-05T00:00:00Z',
    };
    expect(
      isSamePost({
        item,
        caption: '한글\n문장',
        notBeforeMs: Date.parse(item.timestamp),
      }),
    ).toBe(true);
  });
  it('게시 시각이 기준보다 빠르면 다른 게시물로 판정한다', () => {
    const item = {
      id: 'id',
      permalink: 'link',
      caption: 'caption',
      timestamp: '2026-11-05T00:00:00Z',
    };
    expect(
      isSamePost({
        item,
        caption: 'caption',
        notBeforeMs: Date.parse(item.timestamp) + 1,
      }),
    ).toBe(false);
  });
});
