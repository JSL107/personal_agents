import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { scanReadyReels } from './scan-ready-reels';

describe('scanReadyReels', () => {
  const day = '2026-11-06';
  const script = {
    title: 'AI 제목 · 개발 제목',
    duration: 58.5,
    cover_offset_ms: 58_250,
    segments: [{ field: 'ai' }, { field: 'dev' }],
  };
  let outRoot: string;
  let reelDir: string;

  beforeEach(async () => {
    outRoot = await mkdtemp(join(tmpdir(), 'scan-ready-reels-'));
    reelDir = join(outRoot, day, 'daily');
  });

  afterEach(async () => {
    await rm(outRoot, { recursive: true, force: true });
  });

  const writeReel = async ({
    caption = '  릴스 캡션  ',
    withDone = true,
    withStory = true,
    scriptBody = script as unknown,
  } = {}): Promise<void> => {
    await mkdir(reelDir, { recursive: true });
    await writeFile(join(reelDir, 'reel.mp4'), Buffer.from('video bytes'));
    await writeFile(join(reelDir, 'caption.txt'), caption);
    await writeFile(join(reelDir, 'script.json'), JSON.stringify(scriptBody));
    if (withStory) {
      await writeFile(join(reelDir, 'story.mp4'), Buffer.from('story'));
    }
    if (withDone) {
      await writeFile(join(reelDir, 'done.json'), '{}');
    }
  };
  const hash = (text: string): string =>
    createHash('sha256').update(text).digest('hex');

  it('하루 1편 폴더를 읽어 카드 payload 를 만든다', async () => {
    await writeReel();

    const result = await scanReadyReels({ outRoot, day });

    expect(result.ready).toEqual([
      {
        reelKey: `${day}/daily`,
        field: 'daily',
        title: 'AI 제목 · 개발 제목',
        videoPath: join(reelDir, 'reel.mp4'),
        videoSha256: hash('video bytes'),
        videoBytes: 11,
        caption: '릴스 캡션',
        durationSec: 58.5,
        segmentFields: ['ai', 'dev'],
        coverOffsetMs: 58_250,
        story: {
          videoPath: join(reelDir, 'story.mp4'),
          videoSha256: hash('story'),
          videoBytes: 5,
        },
      },
    ]);
    expect(result.tooLong).toEqual([]);
  });

  it('같은 날 예전 ai 폴더가 있어도 보지 않는다', async () => {
    const oldDir = join(outRoot, day, 'ai');
    await mkdir(oldDir, { recursive: true });
    for (const name of ['done.json', 'reel.mp4', 'caption.txt']) {
      await writeFile(join(oldDir, name), '{}');
    }
    await writeFile(
      join(oldDir, 'script.json'),
      JSON.stringify({ row: { title: 'old' }, duration: 30 }),
    );

    const result = await scanReadyReels({ outRoot, day });

    expect(result).toEqual({ ready: [], tooLong: [] });
  });

  it('story.mp4 가 없으면 스토리 없이 릴스만 낸다', async () => {
    await writeReel({ withStory: false });

    const [reel] = (await scanReadyReels({ outRoot, day })).ready;

    expect(reel.story).toBeUndefined();
  });

  it('story.mp4 가 심볼릭 링크면 스토리만 빼고 경고한다', async () => {
    await writeReel();
    await rename(join(reelDir, 'story.mp4'), join(reelDir, 'story.target'));
    await symlink(join(reelDir, 'story.target'), join(reelDir, 'story.mp4'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    try {
      const [reel] = (await scanReadyReels({ outRoot, day })).ready;

      expect(reel.story).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('스토리 파일을 건너뜁니다'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('표지 지점이 없으면 coverOffsetMs 를 넣지 않는다', async () => {
    await writeReel({ scriptBody: { ...script, cover_offset_ms: undefined } });

    const [reel] = (await scanReadyReels({ outRoot, day })).ready;

    expect(reel).not.toHaveProperty('coverOffsetMs');
  });

  it('done.json 이 없으면 경고 없이 빈 결과', async () => {
    await writeReel({ withDone: false });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    try {
      expect(await scanReadyReels({ outRoot, day })).toEqual({
        ready: [],
        tooLong: [],
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('캡션이 2201자이면 tooLong 1건으로 분류한다', async () => {
    await writeReel({ caption: '가'.repeat(2201) });

    const result = await scanReadyReels({ outRoot, day });

    expect(result.ready).toEqual([]);
    expect(result.tooLong).toEqual([
      { reelKey: `${day}/daily`, captionChars: 2201 },
    ]);
  });

  it.each([
    [
      '예전 형식(row.title)만 있으면',
      { row: { title: '제목' }, duration: 32.5 },
    ],
    ['길이가 숫자가 아니면', { ...script, duration: '32.5' }],
    ['꼭지 분야가 모르는 값이면', { ...script, segments: [{ field: 'x' }] }],
    ['표지 지점이 정수가 아니면', { ...script, cover_offset_ms: 1.5 }],
  ])('대본의 %s 준비된 릴스에서 제외한다', async (_condition, body) => {
    await writeReel({ scriptBody: body });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    try {
      expect(await scanReadyReels({ outRoot, day })).toEqual({
        ready: [],
        tooLong: [],
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('script.json 형식이 잘못되었습니다'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it.each(['done.json', 'reel.mp4', 'caption.txt', 'script.json'])(
    '%s 파일이 심볼릭 링크이면 건너뛰고 경고한다',
    async (fileName) => {
      await writeReel();
      const filePath = join(reelDir, fileName);
      const targetPath = join(reelDir, `${fileName}.target`);
      await rename(filePath, targetPath);
      await symlink(targetPath, filePath);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      try {
        expect(await scanReadyReels({ outRoot, day })).toEqual({
          ready: [],
          tooLong: [],
        });
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(`${day}/daily 릴스 파일을 건너뜁니다`),
        );
      } finally {
        warn.mockRestore();
      }
    },
  );
});
