import { ConfigService } from '@nestjs/config';

import { MAX_IMAGE_BYTES, SelectedImage } from '../domain/transcript-image';
import { SlackImageDownloader } from './slack-image.downloader';

const image = (index: number, mimetype = 'image/png'): SelectedImage => ({
  index,
  ts: String(index),
  file: {
    id: `F${index}`,
    mimetype,
    size: 1,
    urlPrivateDownload: 'https://files.slack.com/file',
  },
});

const downloaderWithToken = (): SlackImageDownloader =>
  new SlackImageDownloader({ get: () => 'secret' } as unknown as ConfigService);

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

it('3xx redirect 응답은 따라가지 않고 파일로 저장하지 않는다', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/login' },
    }),
  );
  const result = await downloaderWithToken().download([image(1)]);

  expect(fetchSpy).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({ redirect: 'manual' }),
  );
  expect(result.images).toEqual([]);
  expect(result.failedCount).toBe(1);
  await result.dispose();
  fetchSpy.mockRestore();
});

it('한 사진의 요청이 타임아웃이어도 다음 사진은 내려받는다', async () => {
  const fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
    .mockResolvedValueOnce(
      new Response('image', { headers: { 'content-type': 'image/png' } }),
    );
  const result = await downloaderWithToken().download([image(1), image(2)]);

  expect(result.images.map((downloadedImage) => downloadedImage.index)).toEqual(
    [2],
  );
  expect(result.failedCount).toBe(1);
  await result.dispose();
  fetchSpy.mockRestore();
});

it('응답 본문이 5MB 를 넘으면 파일을 버리고 실패로 센다', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(new Uint8Array(MAX_IMAGE_BYTES + 1), {
      headers: { 'content-type': 'image/png' },
    }),
  );
  const result = await downloaderWithToken().download([image(1)]);

  expect(result.images).toEqual([]);
  expect(result.failedCount).toBe(1);
  await result.dispose();
  fetchSpy.mockRestore();
});

it('임시 폴더를 만들지 못하면 모든 사진을 실패로 센다', async () => {
  const filesystem = await import('node:fs/promises');
  const makeDirectory = jest
    .spyOn(filesystem, 'mkdtemp')
    .mockRejectedValueOnce(new Error('folder unavailable'));
  const fetchSpy = jest.spyOn(global, 'fetch');
  const result = await downloaderWithToken().download([image(1), image(2)]);

  expect(result.images).toEqual([]);
  expect(result.failedCount).toBe(2);
  expect(fetchSpy).not.toHaveBeenCalled();
  await result.dispose();
  makeDirectory.mockRestore();
  fetchSpy.mockRestore();
});

it('저장 파일 확장자는 사진 MIME 의 png·jpg 와 일치한다', async () => {
  const fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(
      new Response('image', { headers: { 'content-type': 'image/png' } }),
    );
  const result = await downloaderWithToken().download([
    image(1),
    image(2, 'image/jpeg'),
  ]);

  expect(result.images.map((downloadedImage) => downloadedImage.path)).toEqual([
    expect.stringMatching(/\/1\.png$/),
    expect.stringMatching(/\/2\.jpg$/),
  ]);
  await result.dispose();
  fetchSpy.mockRestore();
});

it('다운로드 경고에는 토큰과 사진 URL 을 남기지 않는다', async () => {
  const { Logger } = await import('@nestjs/common');
  const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  const fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(new Error('private download failed'));
  const result = await downloaderWithToken().download([image(1)]);

  expect(warnSpy).toHaveBeenCalled();
  const warnings = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
  expect(warnings).not.toContain('secret');
  expect(warnings).not.toContain('https://files.slack.com/file');
  await result.dispose();
  warnSpy.mockRestore();
  fetchSpy.mockRestore();
});
