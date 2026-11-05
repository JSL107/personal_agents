import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { ReelPublishPayload } from '../domain/instagram-post.type';

const LOGGER = new Logger('ScanReadyReels');
const REEL_FIELDS = ['ai', 'dev'] as const;
const MAX_CAPTION_CHARS = 2200;

export interface ScanResult {
  ready: ReelPublishPayload[];
  tooLong: { reelKey: string; captionChars: number }[];
}

interface ScanReadyReelsInput {
  outRoot: string;
  day: string;
}

interface ReelScript {
  row: { title: string };
  duration: number;
}

export const scanReadyReels = async ({
  outRoot,
  day,
}: ScanReadyReelsInput): Promise<ScanResult> => {
  const result: ScanResult = { ready: [], tooLong: [] };

  for (const field of REEL_FIELDS) {
    const reelKey = `${day}/${field}`;
    const reelDir = join(outRoot, day, field);

    try {
      for (const fileName of [
        'done.json',
        'reel.mp4',
        'caption.txt',
        'script.json',
      ]) {
        const fileStat = await lstat(join(reelDir, fileName));
        if (fileStat.isSymbolicLink()) {
          throw new Error(`${fileName} 심볼릭 링크는 허용하지 않습니다`);
        }
      }
      const [video, captionText, scriptText] = await Promise.all([
        readFile(join(reelDir, 'reel.mp4')),
        readFile(join(reelDir, 'caption.txt'), 'utf8'),
        readFile(join(reelDir, 'script.json'), 'utf8'),
      ]);

      const script = JSON.parse(scriptText) as ReelScript;
      if (
        typeof script.row?.title !== 'string' ||
        typeof script.duration !== 'number' ||
        !Number.isFinite(script.duration)
      ) {
        throw new Error('script.json 형식이 잘못되었습니다');
      }

      const caption = captionText.trim();
      if (caption.length > MAX_CAPTION_CHARS) {
        result.tooLong.push({ reelKey, captionChars: caption.length });
        continue;
      }

      const videoPath = join(reelDir, 'reel.mp4');
      const videoSha256 = createHash('sha256').update(video).digest('hex');
      result.ready.push({
        reelKey,
        field,
        title: script.row.title,
        videoPath,
        videoSha256,
        videoBytes: video.length,
        caption,
        durationSec: script.duration,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      LOGGER.warn(`${reelKey} 릴스 파일을 건너뜁니다: ${reason}`);
    }
  }

  return result;
};
