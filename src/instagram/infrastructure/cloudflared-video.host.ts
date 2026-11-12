import { ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { Injectable } from '@nestjs/common';

import {
  buildSafeChildEnv,
  killProcessTree,
} from '../../model-router/infrastructure/cli-process.util';
import { InstagramException } from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import {
  PublicVideo,
  PublicVideoHostPort,
} from '../domain/port/public-video-host.port';

const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const STDERR_LIMIT = 64 * 1024;
const PROBE_TIMEOUT_MS = 5_000;
const PUBLIC_DNS_SERVERS = ['1.1.1.1', '1.0.0.1'];

// 경로에 추측할 수 없는 토큰을 넣고 그 경로 하나만 응답한다. 터널 주소가 새어도 다른 파일은 없다.
export const serveVideo = async ({
  video,
  path,
}: {
  video: Buffer;
  path: string;
}): Promise<Server> => {
  const server = createServer((request, response) => {
    const readable = request.method === 'GET' || request.method === 'HEAD';
    if (request.url !== path || !readable) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': video.byteLength,
    });
    response.end(request.method === 'HEAD' ? undefined : video);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  return server;
};

// Meta rupload 는 영상 처리를 요청 안에서 끝내야 하고 약 32초에 끊는다(2026-11-12 실측: 40초 넘는 릴스 전부
// ProcessingFailedError, 같은 영상을 video_url 로 주니 92초 처리 뒤 FINISHED). 그래서 영상을 잠깐 공개 주소로 열어
// Meta 가 가져가게 한다. 계정 없는 cloudflared quick tunnel 을 쓴다.
@Injectable()
export class CloudflaredVideoHost implements PublicVideoHostPort {
  tunnelStartTimeoutMs = 30_000;
  reachableTimeoutMs = 60_000;
  reachableIntervalMs = 2_000;

  async open(video: Buffer): Promise<PublicVideo> {
    const path = `/${randomBytes(16).toString('hex')}.mp4`;
    const server = await serveVideo({ video, path });
    const { port } = server.address() as AddressInfo;
    const child = spawn(
      'cloudflared',
      ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`],
      {
        env: buildSafeChildEnv(),
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true,
      },
    );
    const close = async (): Promise<void> => {
      killProcessTree(child.pid);
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    };
    try {
      const origin = await this.waitForTunnel(child);
      const url = `${origin}${path}`;
      await this.waitUntilReachable(url);
      return { url, close };
    } catch (error) {
      await close();
      throw new InstagramException({
        code: InstagramErrorCode.VIDEO_HOST_FAILED,
        message: `영상 임시 공개 주소를 열지 못했습니다(cloudflared): ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      });
    }
  }

  // resolve·reject 는 처음 한 번만 효력이 있어, 먼저 일어난 일(주소 출력·실행 실패·종료·시간 초과)로 끝난다.
  private async waitForTunnel(child: ChildProcess): Promise<string> {
    const chunks: string[] = [];
    // 주소를 찾은 뒤에도 읽어 버려야 파이프가 차서 cloudflared 가 멈추지 않는다.
    const found = new Promise<string>((resolve) => {
      child.stderr?.on('data', (chunk: Buffer) => {
        if (chunks.join('').length > STDERR_LIMIT) {
          return;
        }
        chunks.push(chunk.toString());
        const match = TUNNEL_URL_PATTERN.exec(chunks.join(''));
        if (match) {
          resolve(match[0]);
        }
      });
    });
    const stopped = new Promise<never>((_, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => {
        reject(new Error(`cloudflared 가 종료됐습니다(exit=${code})`));
      });
    });
    const cancelTimer = new AbortController();
    const timedOut = sleep(this.tunnelStartTimeoutMs, undefined, {
      signal: cancelTimer.signal,
    }).then(() => {
      throw new Error('터널 주소가 제때 나오지 않았습니다');
    });
    try {
      return await Promise.race([found, stopped, timedOut]);
    } finally {
      cancelTimer.abort();
    }
  }

  // quick tunnel 주소는 DNS 반영까지 몇 초 걸린다. 반영 전에 시스템 resolver 로 물으면 macOS 가 '없음'을
  // 캐시해 이후 접속이 계속 실패한다(2026-11-12 실측). 그래서 공개 DNS 로 먼저 기다린 뒤 실제 접속을 확인한다.
  private async waitUntilReachable(url: string): Promise<void> {
    const deadline = Date.now() + this.reachableTimeoutMs;
    const resolver = new Resolver();
    resolver.setServers(PUBLIC_DNS_SERVERS);
    const { hostname } = new URL(url);
    while (Date.now() < deadline) {
      try {
        await resolver.resolve4(hostname);
        break;
      } catch {
        // 아직 DNS 반영 전 — 다시 확인한다.
      }
      await this.sleep();
    }
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (response.ok) {
          return;
        }
      } catch {
        // 터널 연결 직후 실패 — 다시 확인한다.
      }
      await this.sleep();
    }
    throw new Error('터널 주소가 열리지 않았습니다');
  }

  private async sleep(): Promise<void> {
    await sleep(this.reachableIntervalMs);
  }
}
