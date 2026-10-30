import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  MAX_IMAGE_BYTES,
  SelectedImage,
  SLACK_FILE_HOST,
} from '../domain/transcript-image';

export interface DownloadedImage {
  index: number;
  path: string;
}
export interface DownloadedImages {
  images: DownloadedImage[];
  failedCount: number;
  dispose: () => Promise<void>;
}

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

@Injectable()
export class SlackImageDownloader {
  private readonly logger = new Logger(SlackImageDownloader.name);

  constructor(private readonly configService: ConfigService) {}

  async download(images: readonly SelectedImage[]): Promise<DownloadedImages> {
    const token = this.configService.get<string>('SLACK_BOT_TOKEN');
    const empty = (): DownloadedImages => ({
      images: [],
      failedCount: images.length,
      dispose: async () => undefined,
    });
    if (!token || images.length === 0) {
      return empty();
    }
    let directory: string;
    try {
      directory = await realpath(
        await mkdtemp(join(tmpdir(), 'idaeri-chat-images-')),
      );
    } catch (error) {
      this.logger.warn(
        `사진 임시 폴더 생성 실패 — 사진 없이 답한다: ${error instanceof Error ? error.message : String(error)}`,
      );
      return empty();
    }
    const downloaded: DownloadedImage[] = [];
    for (const image of images) {
      try {
        const url = new URL(image.file.urlPrivateDownload);
        if (
          url.protocol !== 'https:' ||
          url.hostname !== SLACK_FILE_HOST ||
          url.port
        ) {
          continue;
        }
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
        });
        if (
          !response.ok ||
          !response.headers
            .get('content-type')
            ?.toLowerCase()
            .startsWith('image/') ||
          !response.body
        ) {
          continue;
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES) {
            break;
          }
          chunks.push(chunk);
        }
        if (size > MAX_IMAGE_BYTES) {
          continue;
        }
        // codex --image 는 확장자로 형식을 판단하므로 MIME 에 맞는 확장자를 붙인다.
        const path = join(
          directory,
          `${image.index}.${IMAGE_EXTENSIONS[image.file.mimetype] ?? 'png'}`,
        );
        await writeFile(path, Buffer.concat(chunks));
        downloaded.push({ index: image.index, path });
      } catch (error) {
        // URL 은 토큰 없이도 접근 경로라 남기지 않는다 — 사진 번호와 오류 종류만 남긴다.
        this.logger.warn(
          `사진 ${image.index}번 내려받기 실패: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      }
    }
    return {
      images: downloaded,
      failedCount: images.length - downloaded.length,
      dispose: async () => {
        await rm(directory, { recursive: true, force: true });
      },
    };
  }
}
