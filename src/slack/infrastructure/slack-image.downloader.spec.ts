import { ConfigService } from '@nestjs/config';

import { SlackImageDownloader } from './slack-image.downloader';

describe('SlackImageDownloader', () => {
  it('토큰이 없으면 요청하지 않고 전부 실패로 센다', async () => {
    const downloader = new SlackImageDownloader({
      get: () => undefined,
    } as unknown as ConfigService);
    const fetchSpy = jest.spyOn(global, 'fetch');
    const result = await downloader.download([
      {
        index: 1,
        ts: '1',
        file: {
          id: 'F',
          mimetype: 'image/png',
          size: 1,
          urlPrivateDownload: 'https://files.slack.com/file',
        },
      },
    ]);
    expect(result.failedCount).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

it('이미지만 내려받고 실패한 사진의 번호를 유지하며 dispose 한다', async () => {
  const { access } = await import('node:fs/promises');
  const fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValueOnce(
      new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    )
    .mockResolvedValueOnce(
      new Response('image', { headers: { 'content-type': 'image/png' } }),
    );
  const downloader = new SlackImageDownloader({
    get: () => 'secret',
  } as unknown as ConfigService);
  const file = {
    id: 'F',
    mimetype: 'image/png',
    size: 1,
    urlPrivateDownload: 'https://files.slack.com/file',
  };
  const result = await downloader.download([
    { index: 1, ts: '1', file },
    { index: 2, ts: '2', file },
  ]);
  expect(fetchSpy).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      headers: { Authorization: 'Bearer secret' },
      redirect: 'manual',
    }),
  );
  expect(result.failedCount).toBe(1);
  expect(result.images[0].index).toBe(2);
  await access(result.images[0].path);
  await result.dispose();
  await expect(access(result.images[0].path)).rejects.toThrow();
  fetchSpy.mockRestore();
});

it('Slack 외부 호스트는 요청하지 않는다', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  const downloader = new SlackImageDownloader({
    get: () => 'secret',
  } as unknown as ConfigService);
  const result = await downloader.download([
    {
      index: 1,
      ts: '1',
      file: {
        id: 'F',
        mimetype: 'image/png',
        size: 1,
        urlPrivateDownload: 'https://example.com/file',
      },
    },
  ]);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(result.failedCount).toBe(1);
  await result.dispose();
  fetchSpy.mockRestore();
});
