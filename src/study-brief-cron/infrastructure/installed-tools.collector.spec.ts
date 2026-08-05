import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as cliProcessUtil from '../../model-router/infrastructure/cli-process.util';
import { InstalledToolsCollector } from './installed-tools.collector';

describe('InstalledToolsCollector', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'study-tools-'));
    jest.spyOn(cliProcessUtil, 'getRealHomeDir').mockReturnValue(homeDir);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(homeDir, { recursive: true, force: true });
  });

  it('경로가 모두 없으면 빈 배열을 반환한다', async () => {
    await expect(new InstalledToolsCollector().collect()).resolves.toEqual([]);
  });

  it('네 출처를 합쳐 중복 제거 후 정렬한다', async () => {
    await mkdir(join(homeDir, '.claude/skills/context7'), { recursive: true });
    await mkdir(join(homeDir, '.claude/plugins/cache/serena'), {
      recursive: true,
    });
    await mkdir(join(homeDir, '.hermes/skills/context7'), { recursive: true });
    await writeFile(
      join(homeDir, '.claude.json'),
      JSON.stringify({ mcpServers: { notion: { token: 'DO_NOT_LEAK' } } }),
    );

    await expect(new InstalledToolsCollector().collect()).resolves.toEqual([
      'context7',
      'notion',
      'serena',
    ]);
  });

  it('.claude.json의 mcpServers 키만 반환하고 값은 결과에 노출하지 않는다', async () => {
    await writeFile(
      join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          github: { token: 'SECRET_TOKEN', command: 'secret-command' },
        },
      }),
    );

    const tools = await new InstalledToolsCollector().collect();

    expect(tools).toEqual(['github']);
    expect(JSON.stringify(tools)).not.toContain('SECRET_TOKEN');
    expect(JSON.stringify(tools)).not.toContain('secret-command');
  });
});
