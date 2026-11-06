import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readReelScript } from './read-reel-script';

describe('readReelScript', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'read-reel-script-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const folder = (name: string): string => {
    const directory = join(root, name);
    mkdirSync(directory);
    return directory;
  };

  it('영상 옆 script.json 을 읽는다', async () => {
    const directory = folder('daily');
    writeFileSync(join(directory, 'script.json'), '{"duration":52}');
    await expect(readReelScript(join(directory, 'reel.mp4'))).resolves.toEqual({
      duration: 52,
    });
  });

  it('script.json 이 심볼릭 링크면 읽지 않는다', async () => {
    const directory = folder('daily');
    const outside = join(root, 'outside.json');
    writeFileSync(outside, '{"duration":52}');
    symlinkSync(outside, join(directory, 'script.json'));
    await expect(
      readReelScript(join(directory, 'reel.mp4')),
    ).resolves.toBeNull();
  });

  it('폴더가 심볼릭 링크면 읽지 않는다', async () => {
    const real = folder('real');
    writeFileSync(join(real, 'script.json'), '{"duration":52}');
    const linked = join(root, 'linked');
    symlinkSync(real, linked);
    await expect(readReelScript(join(linked, 'reel.mp4'))).resolves.toBeNull();
  });

  it('깨진 JSON 이나 없는 파일은 null', async () => {
    const directory = folder('daily');
    writeFileSync(join(directory, 'script.json'), '{');
    await expect(
      readReelScript(join(directory, 'reel.mp4')),
    ).resolves.toBeNull();
    await expect(
      readReelScript(join(root, 'missing', 'reel.mp4')),
    ).resolves.toBeNull();
  });
});
