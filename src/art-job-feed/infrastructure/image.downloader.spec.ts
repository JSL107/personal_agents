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
      arrayBuffer: async () => Uint8Array.from([1, 2]).buffer,
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
});
