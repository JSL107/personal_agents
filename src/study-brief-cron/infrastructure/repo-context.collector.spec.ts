import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RepoContextCollector } from './repo-context.collector';

describe('RepoContextCollector', () => {
  let repositoryRoot: string;

  beforeEach(async () => {
    repositoryRoot = await mkdtemp(join(tmpdir(), 'repo-context-'));
    jest.spyOn(process, 'cwd').mockReturnValue(repositoryRoot);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(repositoryRoot, { recursive: true, force: true });
  });

  it('src 모듈 디렉터리를 모으고 agent 하위 모듈에 registry 설명을 붙인다', async () => {
    await mkdir(join(repositoryRoot, 'src/agent/cto'), { recursive: true });
    await mkdir(join(repositoryRoot, 'src/study-brief-cron'), {
      recursive: true,
    });
    await writeFile(join(repositoryRoot, 'src/ignored.ts'), 'export {};');

    const modules = await new RepoContextCollector().collect();

    expect(modules).toEqual([
      {
        name: 'agent/cto',
        description: '스터디 주제를 판정한다',
      },
      { name: 'study-brief-cron', description: '' },
    ]);
  });

  it('src 경로가 없으면 빈 배열을 반환한다', async () => {
    await expect(new RepoContextCollector().collect()).resolves.toEqual([]);
  });

  it('모듈 수를 정렬 후 100개로 제한한다', async () => {
    await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        mkdir(
          join(repositoryRoot, `src/module-${String(index).padStart(3, '0')}`),
          {
            recursive: true,
          },
        ),
      ),
    );

    const modules = await new RepoContextCollector().collect();

    expect(modules).toHaveLength(100);
    expect(modules[0].name).toBe('module-000');
    expect(modules[99].name).toBe('module-099');
  });
});
