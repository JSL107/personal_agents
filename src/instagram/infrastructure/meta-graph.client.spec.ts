import { ConfigService } from '@nestjs/config';

import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import {
  InsightKind,
  MediaInsightsResultKind,
} from '../domain/port/meta-graph.port';
import { MetaGraphClient } from './meta-graph.client';

describe('MetaGraphClient', () => {
  const originalFetch = global.fetch;
  const config = {
    INSTAGRAM_PUBLISH_ENABLED: 'true',
    META_APP_ID: 'app-id',
    META_APP_SECRET: 'app-secret',
    META_PAGE_TOKEN: 'secret-page-token',
    INSTAGRAM_USER_ID: 'ig-user',
  };
  let fetchMock: jest.Mock;
  let client: MetaGraphClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    client = new MetaGraphClient({
      get: (key: string) => config[key as keyof typeof config],
    } as ConfigService);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('게시 한도 응답에 사용량과 총량이 있으면 두 값을 반환한다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ quota_usage: 2, config: { quota_total: 100 } }],
      }),
    });
    await expect(client.getPublishingLimit()).resolves.toEqual({
      usage: 2,
      total: 100,
    });
  });

  it('첫 한도 항목이 유효하면 뒤 항목과 관계없이 첫 값을 반환한다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ quota_usage: 2, config: { quota_total: 100 } }, {}],
      }),
    });
    await expect(client.getPublishingLimit()).resolves.toEqual({
      usage: 2,
      total: 100,
    });
  });

  it('최근 게시물에 캡션이 없으면 null로 반환한다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'media',
            permalink: 'https://example.com/reel',
            timestamp: '2026-11-05T00:00:00Z',
          },
        ],
      }),
    });
    await expect(client.listRecentMedia(1)).resolves.toEqual([
      {
        id: 'media',
        caption: null,
        permalink: 'https://example.com/reel',
        timestamp: '2026-11-05T00:00:00Z',
      },
    ]);
  });

  it('릴스 컨테이너를 만들면 폼 본문으로 요청하고 업로드 주소를 반환한다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'container',
        uri: 'https://upload.example/media',
      }),
    });
    const result = await client.createReelContainer({ caption: '한글 캡션' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(result).toEqual({
      containerId: 'container',
      uploadUri: 'https://upload.example/media',
    });
    expect(url).not.toContain('한글');
    expect(url).not.toContain('secret-page-token');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
    );
    expect(new URLSearchParams(init.body as string)).toEqual(
      new URLSearchParams({
        media_type: 'REELS',
        upload_type: 'resumable',
        caption: '한글 캡션',
        share_to_feed: 'true',
        access_token: 'secret-page-token',
      }),
    );
    expect(init.signal).toBeDefined();
  });

  it('표지 지점이 있으면 thumb_offset 을 보낸다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'container',
        uri: 'https://upload.example/media',
      }),
    });
    await client.createReelContainer({ caption: 'c', thumbOffsetMs: 58_250 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URLSearchParams(init.body as string).get('thumb_offset')).toBe(
      '58250',
    );
  });

  it('스토리 컨테이너는 STORIES 로 만들고 캡션을 보내지 않는다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'story', uri: 'https://upload.example/story' }),
    });
    const result = await client.createStoryContainer();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(result).toEqual({
      containerId: 'story',
      uploadUri: 'https://upload.example/story',
    });
    expect(new URLSearchParams(init.body as string)).toEqual(
      new URLSearchParams({
        media_type: 'STORIES',
        upload_type: 'resumable',
        access_token: 'secret-page-token',
      }),
    );
  });

  it('영상을 업로드하면 OAuth 헤더와 시간 제한을 설정한다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    await client.uploadVideo({
      uploadUri: 'https://rupload.facebook.com/media',
      video: Buffer.from('video'),
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: 'OAuth secret-page-token',
        offset: '0',
        file_size: '5',
        'Content-Type': 'application/octet-stream',
      }),
    );
    expect(init.signal).toBeDefined();
  });

  it('업로드 주소가 Meta 호스트가 아니면 요청하지 않는다', async () => {
    await expect(
      client.uploadVideo({
        uploadUri: 'https://upload.example/media',
        video: Buffer.from('video'),
      }),
    ).rejects.toMatchObject({
      errorCode: InstagramErrorCode.GRAPH_REQUEST_FAILED,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('업로드 주소가 HTTP이면 요청하지 않는다', async () => {
    await expect(
      client.uploadVideo({
        uploadUri: 'http://rupload.facebook.com/media',
        video: Buffer.from('video'),
      }),
    ).rejects.toMatchObject({
      errorCode: InstagramErrorCode.GRAPH_REQUEST_FAILED,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('업로드가 실패하면 정제한 debug_info.message를 오류에 넣는다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: false,
        debug_info: {
          message:
            'upload failed secret-page-token at https://example.com/private',
        },
      }),
    });
    await expect(
      client.uploadVideo({
        uploadUri: 'https://rupload.facebook.com/media',
        video: Buffer.from('video'),
      }),
    ).rejects.toMatchObject({
      errorCode: InstagramErrorCode.GRAPH_REQUEST_FAILED,
      message: expect.stringContaining('upload failed [REDACTED] at [URL]'),
    });
  });

  it('업로드가 HTTP 400 이면 정제한 debug_info 사유를 오류에 넣는다', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        debug_info: {
          type: 'ProcessingFailedError',
          message: 'bad file secret-page-token https://example.com/x',
        },
      }),
    });
    await expect(
      client.uploadVideo({
        uploadUri: 'https://rupload.facebook.com/media',
        video: Buffer.from('video'),
      }),
    ).rejects.toMatchObject({
      errorCode: InstagramErrorCode.GRAPH_REQUEST_FAILED,
      message:
        'Meta 요청 실패: HTTP 400: ProcessingFailedError bad file [REDACTED] [URL]',
    });
  });

  it('HTTP 오류에 debug_info 가 없으면 상태 코드만 남긴다', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
    });
    await expect(client.getContainerStatus('container')).rejects.toMatchObject({
      message: 'Meta 요청 실패: HTTP 400',
    });
  });

  it('컨테이너 상태를 받으면 민감 정보를 정제해 반환한다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status_code: 'ERROR',
        status: 'secret-page-token at https://example.com/private',
      }),
    });
    await expect(client.getContainerStatus('container')).resolves.toEqual({
      statusCode: 'ERROR',
      status: '[REDACTED] at [URL]',
    });
  });

  it('게시 설정 문제를 받으면 민감 정보를 정제해 반환한다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'media',
        config_issue: 'secret-page-token at https://example.com/private',
      }),
    });
    await expect(client.publish('container')).resolves.toEqual({
      mediaId: 'media',
      configIssue: '[REDACTED] at [URL]',
    });
  });

  it.each([
    [{ code: 190 }, InstagramErrorCode.TOKEN_INVALID],
    [{ code: 9, error_subcode: 2207042 }, InstagramErrorCode.QUOTA_EXCEEDED],
  ])('알려진 Graph 오류 %j를 도메인 오류로 변환한다', async (error, code) => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error }) });
    await expect(client.getPublishingLimit()).rejects.toMatchObject({
      errorCode: code,
    });
  });

  it('알 수 없는 Graph 오류를 받으면 일반 요청 오류로 감싼다', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { code: 25, error_subcode: 2207050, message: 'restricted' },
      }),
    });
    await expect(client.getPublishingLimit()).rejects.toMatchObject({
      errorCode: InstagramErrorCode.GRAPH_REQUEST_FAILED,
      message: expect.stringContaining('2207050'),
    });
  });

  it('Graph 오류의 진단 필드와 사용자 문구를 정제해 남긴다', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: {
          code: 200,
          message: 'API access blocked.',
          error_user_title: '차단됨',
          error_user_msg: 'secret-page-token 제한',
          type: 'OAuthException',
          is_transient: false,
          fbtrace_id: 'AbC123',
        },
      }),
    });
    await expect(client.getPublishingLimit()).rejects.toMatchObject({
      message:
        'Meta 오류 200/unknown: 차단됨 — [REDACTED] 제한 / API access blocked. (type=OAuthException, transient=false, trace=AbC123)',
    });
  });

  it.each([
    new TypeError('secret-page-token'),
    Object.assign(new Error('secret-page-token'), { name: 'AbortError' }),
  ])('fetch가 실패하면 토큰을 노출하지 않고 오류로 감싼다', async (error) => {
    fetchMock.mockRejectedValue(error);
    await expect(client.getPublishingLimit()).rejects.toMatchObject({
      errorCode: InstagramErrorCode.GRAPH_REQUEST_FAILED,
    });
    await expect(client.getPublishingLimit()).rejects.not.toThrow(
      'secret-page-token',
    );
  });

  it('인스타 게시가 꺼져 있으면 설정되지 않은 것으로 판단한다', () => {
    const disabled = new MetaGraphClient({
      get: (key: string) =>
        key === 'INSTAGRAM_PUBLISH_ENABLED'
          ? 'false'
          : config[key as keyof typeof config],
    } as ConfigService);
    expect(disabled.isConfigured()).toBe(false);
  });

  it('무효 토큰 응답에 나머지 필드가 없어도 무효로 반환한다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { is_valid: false } }),
    });
    await expect(client.debugPageToken()).resolves.toEqual({
      isValid: false,
      expiresAt: 0,
      dataAccessExpiresAt: 0,
      scopes: [],
    });
  });

  it('토큰 점검에서 Graph 오류 190이면 앱 자격 증명 오류로 안내한다', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { code: 190, message: 'Invalid app token' },
      }),
    });
    await expect(client.debugPageToken()).rejects.toMatchObject({
      errorCode: InstagramErrorCode.GRAPH_REQUEST_FAILED,
      message: expect.stringContaining('META_APP_ID/META_APP_SECRET 확인'),
    });
  });

  describe('인사이트', () => {
    const okJson = (body: unknown) => ({ ok: true, json: async () => body });
    const requestedMetrics = () =>
      new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('metric');

    it('릴스 지표를 고정 목록으로 요청하고 없는 지표는 null 로 돌려준다', async () => {
      const data = [
        { name: 'views', period: 'lifetime', values: [{ value: 84 }] },
        { name: 'ig_reels_avg_watch_time', values: [{ value: 4432 }] },
        { name: 'reels_skip_rate', values: [{ value: 69.7 }] },
      ];
      fetchMock.mockResolvedValue(okJson({ data }));

      const result = await client.getMediaInsights({
        mediaId: 'media-1',
        kind: InsightKind.REELS,
      });

      expect(fetchMock.mock.calls[0][0]).toContain('/media-1/insights?');
      expect(requestedMetrics()).toBe(
        'views,reach,likes,comments,shares,saved,total_interactions,reposts,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate',
      );
      expect(result).toEqual({
        kind: MediaInsightsResultKind.OK,
        raw: data,
        metrics: {
          views: 84,
          reach: null,
          likes: null,
          comments: null,
          shares: null,
          saved: null,
          totalInteractions: null,
          reposts: null,
          replies: null,
          avgWatchMs: 4432,
          totalWatchMs: null,
          skipRate: 69.7,
        },
      });
    });

    it('스토리 지표를 고정 목록으로 요청한다', async () => {
      fetchMock.mockResolvedValue(okJson({ data: [] }));
      await client.getMediaInsights({
        mediaId: 'story-1',
        kind: InsightKind.STORY,
      });
      expect(requestedMetrics()).toBe(
        'views,reach,replies,shares,total_interactions,follows,profile_visits',
      );
    });

    it('조회 5 미만(#10)은 오류가 아니라 결과로 돌려준다', async () => {
      const body = {
        error: {
          code: 10,
          message: '(#10) Not enough viewers for the media to show insights',
        },
      };
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => body,
      });
      await expect(
        client.getMediaInsights({
          mediaId: 'story-1',
          kind: InsightKind.STORY,
        }),
      ).resolves.toEqual({
        kind: MediaInsightsResultKind.NOT_ENOUGH_VIEWERS,
        raw: {
          code: 10,
          message: expect.stringContaining('Not enough viewers'),
        },
      });
    });

    it('같은 #10 이라도 권한 부족이면 조회 5 미만으로 보지 않고 던진다', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: 10,
            message:
              '(#10) Application does not have permission for this action',
          },
        }),
      });
      await expect(
        client.getMediaInsights({
          mediaId: 'media-1',
          kind: InsightKind.REELS,
        }),
      ).rejects.toMatchObject({
        instagramErrorCode: InstagramErrorCode.GRAPH_REQUEST_FAILED,
      });
    });

    it('토큰 오류(190)는 그대로 던진다', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 190, message: 'expired' } }),
      });
      await expect(
        client.getMediaInsights({
          mediaId: 'media-1',
          kind: InsightKind.REELS,
        }),
      ).rejects.toMatchObject({
        instagramErrorCode: InstagramErrorCode.TOKEN_INVALID,
      });
    });

    it('팔로워 수를 읽는다', async () => {
      fetchMock.mockResolvedValue(
        okJson({ followers_count: 2, id: 'ig-user' }),
      );
      await expect(client.getFollowersCount()).resolves.toBe(2);
      expect(fetchMock.mock.calls[0][0]).toContain('/ig-user?');
      expect(fetchMock.mock.calls[0][0]).toContain('fields=followers_count');
    });

    it('팔로워 수가 숫자가 아니면 요청 실패로 던진다', async () => {
      fetchMock.mockResolvedValue(okJson({ id: 'ig-user' }));
      await expect(client.getFollowersCount()).rejects.toMatchObject({
        instagramErrorCode: InstagramErrorCode.GRAPH_REQUEST_FAILED,
      });
    });
  });
});
