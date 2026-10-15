import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import * as sharpModule from 'sharp';

import { DownloadedImage } from '../domain/art-job-feed.type';
import { ImageDownloaderPort } from '../domain/port/art-job-feed.ports';
import { assertPublicUrl } from './public-url.guard';

// sharp 는 CJS 에서 module.exports 가 함수 자체인데 타입은 ESM default 로만 낸다.
// 이 레포는 esModuleInterop 이 꺼져 있어 default import 가 런타임에 undefined 다.
const sharp = sharpModule as unknown as typeof sharpModule.default;

const MAX_BYTES = 5 * 1024 * 1024;
// 리다이렉트를 직접 따라가며 매 단계 주소를 다시 검사한다(자동 추적은 내부망 리다이렉트를 못 막는다).
const MAX_REDIRECTS = 3;
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

@Injectable()
export class ImageDownloader implements ImageDownloaderPort {
  async download(url: string): Promise<DownloadedImage> {
    const response = await this.fetchPublic(new URL(url));
    if (!response.ok) {
      throw new Error(`이미지 요청 실패: HTTP ${response.status}`);
    }
    const contentType =
      response.headers
        .get('content-type')
        ?.split(';')[0]
        .trim()
        .toLowerCase() ?? '';
    const extension = EXTENSIONS[contentType];
    if (!contentType.startsWith('image/') || !extension) {
      throw new Error(`지원하지 않는 이미지 형식: ${contentType}`);
    }
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_BYTES) {
      throw new Error('이미지 크기 5MB 초과');
    }
    if (!response.body) {
      throw new Error('이미지 응답 본문 없음');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    for (
      let chunk = await reader.read();
      !chunk.done;
      chunk = await reader.read()
    ) {
      const value = chunk.value;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error('이미지 크기 5MB 초과');
      }
      chunks.push(value);
    }
    const downloaded = Buffer.concat(chunks, totalBytes);
    // 슬랙 이미지 블록은 webp 를 받지 않는다(invalid_blocks, 2026-10-15 루리웹 그림 실측). png 로 바꿔 싣는다.
    const isWebp = extension === 'webp';
    const buffer = isWebp
      ? await sharp(downloaded).png().toBuffer()
      : downloaded;
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
    return {
      buffer,
      filename: `art-job-${hash}.${isWebp ? 'png' : extension}`,
    };
  }

  private async fetchPublic(start: URL): Promise<Response> {
    let current = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublicUrl(current);
      const response = await fetch(current, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'manual',
      });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) {
        return response;
      }
      current = new URL(location, current);
    }
    throw new Error(`이미지 리다이렉트 ${MAX_REDIRECTS}회 초과`);
  }
}
