import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { DownloadedImage } from '../domain/art-job-feed.type';
import { ImageDownloaderPort } from '../domain/port/art-job-feed.ports';

const MAX_BYTES = 5 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

@Injectable()
export class ImageDownloader implements ImageDownloaderPort {
  async download(url: string): Promise<DownloadedImage> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
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
    const buffer = Buffer.concat(chunks, totalBytes);
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
    return { buffer, filename: `art-job-${hash}.${extension}` };
  }
}
