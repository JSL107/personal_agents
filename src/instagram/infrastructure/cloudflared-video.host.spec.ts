import { Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { serveVideo } from './cloudflared-video.host';

describe('serveVideo', () => {
  let server: Server;
  let origin: string;
  const video = Buffer.from('mp4-bytes');
  beforeEach(async () => {
    server = await serveVideo({ video, path: '/token.mp4' });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it('토큰 경로에만 영상을 내준다', async () => {
    const response = await fetch(`${origin}/token.mp4`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(video);
  });

  it('HEAD 는 길이만 알려 준다', async () => {
    const response = await fetch(`${origin}/token.mp4`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(
      String(video.byteLength),
    );
  });

  it('다른 경로와 쓰기 요청은 404 다', async () => {
    expect((await fetch(`${origin}/`)).status).toBe(404);
    expect((await fetch(`${origin}/other.mp4`)).status).toBe(404);
    expect(
      (await fetch(`${origin}/token.mp4`, { method: 'POST' })).status,
    ).toBe(404);
  });
});
