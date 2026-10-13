import { ImageDownloader } from './image.downloader';

describe('ImageDownloader', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
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
