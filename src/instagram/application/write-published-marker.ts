import { randomUUID } from 'node:crypto';
import { Stats } from 'node:fs';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { Logger } from '@nestjs/common';

import {
  InstagramPost,
  InstagramPostStatus,
} from '../domain/instagram-post.type';
import { STORY_UNCONFIRMED_PREFIX } from './publish-story.usecase';

const LOGGER = new Logger('WritePublishedMarker');
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// published.json 에 그대로 적히는 값이다. hermes 가 이 파일을 읽는다.
export enum StoryMarkerStatus {
  PUBLISHED = 'PUBLISHED',
  UNCONFIRMED = 'UNCONFIRMED',
  PENDING = 'PENDING',
  NONE = 'NONE',
}

export enum MarkerWriteResult {
  WRITTEN = 'WRITTEN',
  UNCHANGED = 'UNCHANGED',
  SKIPPED = 'SKIPPED',
}

interface PublishedMarker {
  reelKey: string;
  mediaId: string;
  permalink: string;
  publishedAt: string;
  story: {
    status: StoryMarkerStatus;
    permalink: string | null;
  };
}

export type WritePublishedMarkerResult =
  | { kind: MarkerWriteResult.WRITTEN }
  | { kind: MarkerWriteResult.UNCHANGED }
  | { kind: MarkerWriteResult.SKIPPED; reason: string };

export const writePublishedMarker = async ({
  reel,
  story,
}: {
  reel: InstagramPost;
  story: InstagramPost | null;
}): Promise<WritePublishedMarkerResult> => {
  const directory = dirname(reel.videoPath);
  const day = basename(dirname(directory));
  if (
    basename(directory) !== 'daily' ||
    !DAY_PATTERN.test(day) ||
    reel.reelKey !== `${day}/daily`
  ) {
    LOGGER.warn(`게시 표식 경로를 건너뜁니다: ${reel.videoPath}`);
    return {
      kind: MarkerWriteResult.SKIPPED,
      reason: 'daily 경로 또는 reelKey 불일치',
    };
  }
  if (
    reel.status !== InstagramPostStatus.PUBLISHED ||
    !reel.mediaId ||
    !reel.permalink ||
    !reel.publishedAt
  ) {
    return {
      kind: MarkerWriteResult.SKIPPED,
      reason: '릴스 게시 정보가 완전하지 않음',
    };
  }

  const markerPath = join(directory, 'published.json');
  try {
    const marker: PublishedMarker = {
      reelKey: reel.reelKey,
      mediaId: reel.mediaId,
      permalink: reel.permalink,
      publishedAt: reel.publishedAt.toISOString(),
      story: {
        status: storyStatus(story),
        permalink: story?.permalink ?? null,
      },
    };
    const contents = `${JSON.stringify(marker, null, 2)}\n`;
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      return {
        kind: MarkerWriteResult.SKIPPED,
        reason: 'daily 폴더가 일반 디렉터리가 아님',
      };
    }
    const markerStat = await statIfExists(markerPath);
    if (markerStat?.isSymbolicLink()) {
      return {
        kind: MarkerWriteResult.SKIPPED,
        reason: '기존 표식이 심볼릭 링크',
      };
    }
    if (markerStat && !markerStat.isFile()) {
      return {
        kind: MarkerWriteResult.SKIPPED,
        reason: '기존 표식이 일반 파일이 아님',
      };
    }
    if (markerStat && (await readFile(markerPath, 'utf8')) === contents) {
      return { kind: MarkerWriteResult.UNCHANGED };
    }
    await replaceAtomically({ directory, markerPath, contents });
    return { kind: MarkerWriteResult.WRITTEN };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    LOGGER.warn(`게시 표식을 건너뜁니다: ${reason}`);
    return { kind: MarkerWriteResult.SKIPPED, reason };
  }
};

// 같은 폴더의 임시 파일에 쓰고 rename 한다. 실패하면 임시 파일을 지운다.
const replaceAtomically = async ({
  directory,
  markerPath,
  contents,
}: {
  directory: string;
  markerPath: string;
  contents: string;
}): Promise<void> => {
  const temporaryPath = join(directory, `.published-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, contents, { flag: 'wx' });
    await rename(temporaryPath, markerPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

const storyStatus = (story: InstagramPost | null): StoryMarkerStatus => {
  if (!story) {
    return StoryMarkerStatus.NONE;
  }
  if (story.lastError?.startsWith(STORY_UNCONFIRMED_PREFIX)) {
    return StoryMarkerStatus.UNCONFIRMED;
  }
  if (story.status === InstagramPostStatus.PUBLISHED) {
    return StoryMarkerStatus.PUBLISHED;
  }
  return StoryMarkerStatus.PENDING;
};

const statIfExists = async (path: string): Promise<Stats | null> => {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};
