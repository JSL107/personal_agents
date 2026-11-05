import { mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  InstagramPost,
  InstagramPostField,
  InstagramPostStatus,
} from '../domain/instagram-post.type';
import { STORY_UNCONFIRMED_PREFIX } from './publish-story.usecase';
import {
  MarkerWriteResult,
  writePublishedMarker,
} from './write-published-marker';

describe('writePublishedMarker', () => {
  const day = '2026-11-06';
  let root: string;
  let dailyDir: string;

  const post = (patch: Partial<InstagramPost> = {}): InstagramPost => ({
    id: 'post-1',
    reelKey: `${day}/daily`,
    field: InstagramPostField.DAILY,
    title: '오늘의 영상',
    videoPath: join(dailyDir, 'reel.mp4'),
    videoSha256: 'hash',
    caption: '캡션',
    previewActionId: 'preview-1',
    containerId: 'container-1',
    containerCreatedAt: null,
    uploadedAt: null,
    publishAttemptedAt: null,
    mediaId: 'media-1',
    permalink: 'https://instagram.com/p/reel',
    status: InstagramPostStatus.PUBLISHED,
    lastError: null,
    publishedAt: new Date('2026-11-06T01:23:45.000Z'),
    createdAt: new Date('2026-11-06T00:00:00.000Z'),
    updatedAt: new Date('2026-11-06T01:23:45.000Z'),
    ...patch,
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'published-marker-'));
    dailyDir = join(root, day, 'daily');
    await mkdir(dailyDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('처음 게시된 릴스의 표식과 스토리 없음 상태를 기록한다', async () => {
    const result = await writePublishedMarker({ reel: post(), story: null });

    expect(result).toEqual({ kind: MarkerWriteResult.WRITTEN });
    const marker = JSON.parse(
      await readFile(join(dailyDir, 'published.json'), 'utf8'),
    );
    expect(marker).toEqual({
      reelKey: `${day}/daily`,
      mediaId: 'media-1',
      permalink: 'https://instagram.com/p/reel',
      publishedAt: '2026-11-06T01:23:45.000Z',
      story: { status: 'NONE', permalink: null },
    });
  });

  it('내용이 같으면 표식의 수정 시각을 바꾸지 않는다', async () => {
    await writePublishedMarker({ reel: post(), story: null });
    const markerPath = join(dailyDir, 'published.json');
    const before = await stat(markerPath);

    const result = await writePublishedMarker({ reel: post(), story: null });

    expect(result).toEqual({ kind: MarkerWriteResult.UNCHANGED });
    expect((await stat(markerPath)).mtimeMs).toBe(before.mtimeMs);
  });

  it('스토리 상태가 바뀌면 표식을 새 내용으로 교체한다', async () => {
    await writePublishedMarker({ reel: post(), story: null });

    const result = await writePublishedMarker({
      reel: post(),
      story: post({
        reelKey: `${day}/story`,
        field: InstagramPostField.STORY,
        status: InstagramPostStatus.PUBLISHED,
      }),
    });

    const marker = JSON.parse(
      await readFile(join(dailyDir, 'published.json'), 'utf8'),
    );
    expect(result).toEqual({ kind: MarkerWriteResult.WRITTEN });
    expect(marker.story.status).toBe('PUBLISHED');
  });

  it.each([
    ['PUBLISHED', { status: InstagramPostStatus.PUBLISHED }, 'PUBLISHED'],
    [
      'UNCONFIRMED',
      { lastError: `${STORY_UNCONFIRMED_PREFIX} 확인 필요` },
      'UNCONFIRMED',
    ],
    ['PENDING', { status: InstagramPostStatus.PENDING }, 'PENDING'],
  ] as const)(
    '스토리 %s 상태를 표식에 기록한다',
    async (_label, patch, status) => {
      const story = post({
        reelKey: `${day}/story`,
        field: InstagramPostField.STORY,
        permalink: 'https://instagram.com/s/story',
        status: InstagramPostStatus.PUBLISHING,
        ...patch,
      });

      await writePublishedMarker({ reel: post(), story });

      const marker = JSON.parse(
        await readFile(join(dailyDir, 'published.json'), 'utf8'),
      );
      expect(marker.story).toEqual({
        status,
        permalink: 'https://instagram.com/s/story',
      });
    },
  );

  it('daily 폴더가 아닌 영상 경로는 건너뛴다', async () => {
    const result = await writePublishedMarker({
      reel: post({ videoPath: join(root, day, 'ai', 'reel.mp4') }),
      story: null,
    });

    expect(result).toEqual(
      expect.objectContaining({ kind: MarkerWriteResult.SKIPPED }),
    );
  });

  it('daily 폴더가 없으면 건너뛴다', async () => {
    await rm(dailyDir, { recursive: true });

    const result = await writePublishedMarker({ reel: post(), story: null });

    expect(result).toEqual(
      expect.objectContaining({ kind: MarkerWriteResult.SKIPPED }),
    );
  });

  it('기존 표식이 심볼릭 링크면 건너뛰고 링크 대상을 유지한다', async () => {
    const targetPath = join(root, 'target.json');
    await symlink(targetPath, join(dailyDir, 'published.json'));

    const result = await writePublishedMarker({ reel: post(), story: null });

    expect(result).toEqual(
      expect.objectContaining({ kind: MarkerWriteResult.SKIPPED }),
    );
  });

  it('게시 시각이 유효하지 않으면 예외 없이 건너뛴다', async () => {
    const result = await writePublishedMarker({
      reel: post({ publishedAt: new Date('invalid') }),
      story: null,
    });

    expect(result).toEqual(
      expect.objectContaining({ kind: MarkerWriteResult.SKIPPED }),
    );
  });
});
