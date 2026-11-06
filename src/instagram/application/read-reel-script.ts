import { lstat, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// 원장의 영상 경로 옆 script.json 을 읽는다. 폴더나 파일이 심볼릭 링크면 링크 너머를 읽지 않는다
// (write-published-marker 와 같은 규칙). 없거나 깨졌으면 null.
export const readReelScript = async (
  videoPath: string,
): Promise<unknown | null> => {
  const directory = dirname(videoPath);
  const scriptPath = join(directory, 'script.json');
  try {
    const [directoryStat, scriptStat] = await Promise.all([
      lstat(directory),
      lstat(scriptPath),
    ]);
    if (directoryStat.isSymbolicLink() || !scriptStat.isFile()) {
      return null;
    }
    const value: unknown = JSON.parse(await readFile(scriptPath, 'utf8'));
    return value;
  } catch {
    return null;
  }
};
