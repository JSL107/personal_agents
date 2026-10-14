import { lookup } from 'node:dns/promises';

import { ImageDownloader } from './image.downloader';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

const lookupMock = lookup as unknown as jest.Mock;
// 호스트 이름 → 해석 결과. 기본은 공인 주소.
const resolveTo = (table: Record<string, string>) => {
  lookupMock.mockImplementation(async (host: string) => {
    return [{ address: table[host] ?? '93.184.216.34', family: 4 }];
  });
};

describe('ImageDownloader', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    resolveTo({});
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const imageResponse = () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/png' }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
        controller.close();
      },
    }),
  });

  it('내부망으로 해석되는 주소는 요청하지 않는다', async () => {
    resolveTo({ 'evil.example.com': '127.0.0.1' });
    global.fetch = jest.fn();
    await expect(
      new ImageDownloader().download('https://evil.example.com/a.png'),
    ).rejects.toThrow('내부망 주소');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('공인 주소에서 내부망으로 리다이렉트되면 따라가지 않는다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: 'http://169.254.169.254/latest' }),
    });
    await expect(
      new ImageDownloader().download('https://cdn.example.com/a.png'),
    ).rejects.toThrow('내부망 주소');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][1].redirect).toBe(
      'manual',
    );
  });

  it('공인 주소로의 리다이렉트는 따라간다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 301,
        headers: new Headers({ location: '/moved.png' }),
      })
      .mockResolvedValueOnce(imageResponse());
    const image = await new ImageDownloader().download(
      'https://cdn.example.com/a.png',
    );
    expect(image.buffer).toEqual(Buffer.from([1]));
    expect(String((global.fetch as jest.Mock).mock.calls[1][0])).toBe(
      'https://cdn.example.com/moved.png',
    );
  });

  it('리다이렉트가 3회를 넘으면 멈춘다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: '/again' }),
    });
    await expect(
      new ImageDownloader().download('https://cdn.example.com/a.png'),
    ).rejects.toThrow('리다이렉트 3회 초과');
  });

  it('http·https 외 프로토콜은 거부한다', async () => {
    global.fetch = jest.fn();
    await expect(
      new ImageDownloader().download('file:///etc/passwd'),
    ).rejects.toThrow('허용하지 않는 프로토콜');
  });

  it('returns a named image buffer', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2]));
          controller.close();
        },
      }),
    });
    const image = await new ImageDownloader().download(
      'https://example.com/icon',
    );
    expect(image.buffer).toEqual(Buffer.from([1, 2]));
    expect(image.filename).toMatch(/^art-job-[a-f0-9]{12}\.png$/);
  });
  it('rejects non-images', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
    });
    await expect(
      new ImageDownloader().download('https://example.com'),
    ).rejects.toThrow('형식');
  });
  it('stops and cancels a stream as soon as it exceeds 5MB without Content-Length', async () => {
    const cancel = jest.fn();
    const pull = jest.fn(
      (controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: new ReadableStream({ pull, cancel }),
    });
    await expect(
      new ImageDownloader().download('https://example.com/icon'),
    ).rejects.toThrow('5MB');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(pull.mock.calls.length).toBeLessThanOrEqual(7);
  });
  it('rejects an oversized Content-Length before reading the body', async () => {
    const getReader = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        'content-type': 'image/png',
        'content-length': String(5 * 1024 * 1024 + 1),
      }),
      body: { getReader },
    });
    await expect(
      new ImageDownloader().download('https://example.com/icon'),
    ).rejects.toThrow('5MB');
    expect(getReader).not.toHaveBeenCalled();
  });
  it('rejects a response without a body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: null,
    });
    await expect(
      new ImageDownloader().download('https://example.com/icon'),
    ).rejects.toThrow('본문 없음');
  });
});
