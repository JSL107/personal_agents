import { ConfigService } from '@nestjs/config';

import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
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

  it('creates a resumable reel container with form body and returns uri', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'container',
        uri: 'https://upload.example/media',
      }),
    });
    const result = await client.createReelContainer('한글 캡션');
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

  it('uploads video with OAuth headers and timeout', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    await client.uploadVideo(
      'https://upload.example/media',
      Buffer.from('video'),
    );
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

  it.each([
    [{ code: 190 }, InstagramErrorCode.TOKEN_INVALID],
    [{ code: 9, error_subcode: 2207042 }, InstagramErrorCode.QUOTA_EXCEEDED],
  ])('maps known graph error %j', async (error, code) => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error }) });
    await expect(client.getPublishingLimit()).rejects.toMatchObject({
      errorCode: code,
    });
  });

  it('wraps unknown graph error', async () => {
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

  it.each([
    new TypeError('secret-page-token'),
    Object.assign(new Error('secret-page-token'), { name: 'AbortError' }),
  ])('wraps fetch failure without exposing token', async (error) => {
    fetchMock.mockRejectedValue(error);
    await expect(client.getPublishingLimit()).rejects.toMatchObject({
      errorCode: InstagramErrorCode.GRAPH_REQUEST_FAILED,
    });
    await expect(client.getPublishingLimit()).rejects.not.toThrow(
      'secret-page-token',
    );
  });

  it('isConfigured is false when disabled', () => {
    const disabled = new MetaGraphClient({
      get: (key: string) =>
        key === 'INSTAGRAM_PUBLISH_ENABLED'
          ? 'false'
          : config[key as keyof typeof config],
    } as ConfigService);
    expect(disabled.isConfigured()).toBe(false);
  });
});
