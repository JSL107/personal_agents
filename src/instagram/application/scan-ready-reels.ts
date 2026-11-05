import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { isMatching, P } from 'ts-pattern';

import { INSTAGRAM_CAPTION_MAX_CHARS } from '../domain/instagram.constants';
import {
  InstagramPostField,
  ReelPublishPayload,
  StoryVideo,
} from '../domain/instagram-post.type';

const LOGGER = new Logger('ScanReadyReels');
// 하루 1편(AI·개발 두 꼭지) 폴더만 본다. 예전 ai·dev 폴더까지 보면 전환일·되돌림 날에 같은 소식 카드가
// 최대 3장 나가 하루 1편과 중복 방지가 깨진다(2026-11-05 교차 검토).
const REEL_FOLDER = InstagramPostField.DAILY;
const REEL_SCRIPT_PATTERN = {
  title: P.string,
  duration: P.number.finite(),
  cover_offset_ms: P.optional(P.number.int()),
  segments: P.array({
    field: P.union(InstagramPostField.AI, InstagramPostField.DEV),
  }),
};

export interface ScanResult {
  ready: ReelPublishPayload[];
  tooLong: { reelKey: string; captionChars: number }[];
}

interface ScanReadyReelsInput {
  outRoot: string;
  day: string;
}

export const scanReadyReels = async ({
  outRoot,
  day,
}: ScanReadyReelsInput): Promise<ScanResult> => {
  const result: ScanResult = { ready: [], tooLong: [] };
  const reelKey = `${day}/${REEL_FOLDER}`;
  const reelDir = join(outRoot, day, REEL_FOLDER);

  try {
    // 아직 안 만들어진 날은 조용히 넘어간다. 15분마다 도는 조회라 경고를 남기면 하루 수십 줄이 쌓인다.
    if (!(await exists(join(reelDir, 'done.json')))) {
      return result;
    }
    for (const fileName of [
      'done.json',
      'reel.mp4',
      'caption.txt',
      'script.json',
    ]) {
      await assertRegularFile(join(reelDir, fileName), fileName);
    }
    const [video, captionText, scriptText] = await Promise.all([
      readFile(join(reelDir, 'reel.mp4')),
      readFile(join(reelDir, 'caption.txt'), 'utf8'),
      readFile(join(reelDir, 'script.json'), 'utf8'),
    ]);

    const script: unknown = JSON.parse(scriptText);
    if (!isMatching(REEL_SCRIPT_PATTERN, script)) {
      throw new Error('script.json 형식이 잘못되었습니다');
    }

    const caption = captionText.trim();
    if (caption.length > INSTAGRAM_CAPTION_MAX_CHARS) {
      result.tooLong.push({ reelKey, captionChars: caption.length });
      return result;
    }

    const story = await readStory({ reelDir, reelKey });
    result.ready.push({
      reelKey,
      field: InstagramPostField.DAILY,
      title: script.title,
      videoPath: join(reelDir, 'reel.mp4'),
      videoSha256: sha256(video),
      videoBytes: video.length,
      caption,
      durationSec: script.duration,
      segmentFields: script.segments.map((segment) => segment.field),
      ...(script.cover_offset_ms !== undefined
        ? { coverOffsetMs: script.cover_offset_ms }
        : {}),
      ...(story ? { story } : {}),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    LOGGER.warn(`${reelKey} 릴스 파일을 건너뜁니다: ${reason}`);
  }

  return result;
};

// 스토리는 없어도 릴스는 낸다. 심볼릭 링크면 스토리만 빼고 경고한다.
const readStory = async ({
  reelDir,
  reelKey,
}: {
  reelDir: string;
  reelKey: string;
}): Promise<StoryVideo | null> => {
  const videoPath = join(reelDir, 'story.mp4');
  try {
    if (!(await exists(videoPath))) {
      return null;
    }
    await assertRegularFile(videoPath, 'story.mp4');
    const video = await readFile(videoPath);
    return { videoPath, videoSha256: sha256(video), videoBytes: video.length };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    LOGGER.warn(`${reelKey} 스토리 파일을 건너뜁니다: ${reason}`);
    return null;
  }
};

const assertRegularFile = async (
  path: string,
  fileName: string,
): Promise<void> => {
  const fileStat = await lstat(path);
  if (fileStat.isSymbolicLink()) {
    throw new Error(`${fileName} 심볼릭 링크는 허용하지 않습니다`);
  }
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

const sha256 = (data: Buffer): string => {
  const digest = createHash('sha256').update(data).digest('hex');
  return digest;
};
