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
  const day = '2026-11-05';
  let outRoot: string;

  beforeEach(async () => {
    outRoot = await mkdtemp(join(tmpdir(), 'scan-ready-reels-'));
  });

  afterEach(async () => {
    await rm(outRoot, { recursive: true, force: true });
  });

  const writeReel = async (
    field: 'ai' | 'dev',
    caption = '  릴스 캡션  ',
    withDone = true,
  ): Promise<void> => {
    const reelDir = join(outRoot, day, field);
    await mkdir(reelDir, { recursive: true });
    await writeFile(join(reelDir, 'reel.mp4'), Buffer.from('video bytes'));
    await writeFile(join(reelDir, 'caption.txt'), caption);
    await writeFile(
      join(reelDir, 'script.json'),
      JSON.stringify({ row: { title: `${field} 제목` }, duration: 32.5 }),
    );
    if (withDone) {
      await writeFile(join(reelDir, 'done.json'), '{}');
    }
  };

  it('두 편이 완성되면 ready 2건과 영상 해시·크기를 반환한다', async () => {
    await writeReel('ai');
    await writeReel('dev');

    const result = await scanReadyReels({ outRoot, day });

    const sha256 = createHash('sha256').update('video bytes').digest('hex');
    expect(result.ready).toEqual([
      {
        reelKey: `${day}/ai`,
        field: 'ai',
        title: 'ai 제목',
        videoPath: join(outRoot, day, 'ai', 'reel.mp4'),
        videoSha256: sha256,
        videoBytes: 11,
        caption: '릴스 캡션',
        durationSec: 32.5,
      },
      {
        reelKey: `${day}/dev`,
        field: 'dev',
        title: 'dev 제목',
        videoPath: join(outRoot, day, 'dev', 'reel.mp4'),
        videoSha256: sha256,
        videoBytes: 11,
        caption: '릴스 캡션',
        durationSec: 32.5,
      },
    ]);
    expect(result.tooLong).toEqual([]);
  });

  it('partial day: done.json 없는 편을 건너뛴다', async () => {
    await writeReel('ai');
    await writeReel('dev', '캡션', false);

    const result = await scanReadyReels({ outRoot, day });

    expect(result.ready.map((reel) => reel.field)).toEqual(['ai']);
  });

  it('날짜 폴더가 없으면 빈 결과를 반환한다', async () => {
    const result = await scanReadyReels({ outRoot, day });

    expect(result).toEqual({ ready: [], tooLong: [] });
  });

  it('캡션이 2201자이면 tooLong 1건으로 분류한다', async () => {
    await writeReel('ai', '가'.repeat(2201));

    const result = await scanReadyReels({ outRoot, day });

    expect(result.ready).toEqual([]);
    expect(result.tooLong).toEqual([
      { reelKey: `${day}/ai`, captionChars: 2201 },
    ]);
  });

  it.each(['done.json', 'reel.mp4', 'caption.txt', 'script.json'])(
    '%s 파일이 심볼릭 링크이면 해당 편을 건너뛰고 경고한다',
    async (fileName) => {
      await writeReel('ai');
      const reelDir = join(outRoot, day, 'ai');
      const filePath = join(reelDir, fileName);
      const targetPath = join(reelDir, `${fileName}.target`);
      await rename(filePath, targetPath);
      await symlink(targetPath, filePath);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      try {
        const result = await scanReadyReels({ outRoot, day });

        expect(result).toEqual({ ready: [], tooLong: [] });
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(`${day}/ai 릴스 파일을 건너뜁니다`),
        );
      } finally {
        warn.mockRestore();
      }
    },
  );
});
