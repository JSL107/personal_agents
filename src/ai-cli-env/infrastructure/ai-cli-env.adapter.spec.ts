jest.mock('node:child_process', () => ({
  execFile: jest.fn(),
}));

import { execFile } from 'node:child_process';
import * as fileSystem from 'node:fs/promises';
import { homedir } from 'node:os';

import { Logger } from '@nestjs/common';

import { AiCliEnvAdapter } from './ai-cli-env.adapter';

const mockedExecFile = jest.mocked(execFile);

const buildConfig = (values: Record<string, string | undefined>) =>
  ({ get: jest.fn((key: string) => values[key]) }) as never;

const successfulCommand = (): void => {
  mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
    const callback = argumentsValue.at(-1) as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    callback(null, '', '');
    return undefined as never;
  });
};

describe('AiCliEnvAdapter', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    mockedExecFile.mockReset();
    successfulCommand();
    jest
      .spyOn(fileSystem, 'writeFile')
      .mockClear()
      .mockResolvedValue(undefined);
  });

  it('enabled이면 export script 뒤에 변경을 커밋하고 push한다', async () => {
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const [command, argumentsList] = argumentsValue as [string, string[]];
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const stdout =
        command === 'git' && argumentsList[0] === 'status'
          ? ' M manifest.json'
          : '';
      callback(null, stdout, '');
      return undefined as never;
    });
    const adapter = new AiCliEnvAdapter(
      buildConfig({
        AI_CLI_ENV_SYNC_REPO: 'owner/snapshots',
        AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync',
        PATH: '/usr/local/bin',
        SLACK_BOT_TOKEN: 'app-secret',
        DATABASE_URL: 'postgresql://app-secret',
      }),
    );

    await expect(adapter.exportSnapshot()).resolves.toEqual({
      changed: true,
      pushed: true,
    });

    expect(mockedExecFile).toHaveBeenCalledWith(
      'node',
      [
        expect.stringMatching(/scripts\/export-ai-cli-env\.cjs$/),
        '/tmp/ai-cli-env-sync',
      ],
      expect.objectContaining({ timeout: 60_000 }),
      expect.any(Function),
    );
    expect(mockedExecFile).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', expect.stringMatching(/^chore\(env\): 스냅샷 갱신 /)],
      expect.objectContaining({ cwd: '/tmp/ai-cli-env-sync', timeout: 60_000 }),
      expect.any(Function),
    );
    expect(mockedExecFile).toHaveBeenCalledWith(
      'git',
      ['push'],
      expect.objectContaining({ cwd: '/tmp/ai-cli-env-sync' }),
      expect.any(Function),
    );
    for (const [, , options] of mockedExecFile.mock.calls) {
      const environment = (options as { env: Record<string, string> }).env;
      expect(environment).toBeDefined();
      expect(environment).not.toHaveProperty('SLACK_BOT_TOKEN');
      expect(environment).not.toHaveProperty('DATABASE_URL');
    }
  });

  it('push 충돌이면 remote 기본 브랜치로 복구하고 export부터 정확히 한 번 재시도한다', async () => {
    let pushCount = 0;
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const [command, argumentsList] = argumentsValue as [string, string[]];
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      if (command === 'git' && argumentsList[0] === 'push') {
        pushCount += 1;
        callback(
          pushCount === 1 ? new Error('non-fast-forward') : null,
          '',
          '',
        );
      } else if (command === 'git' && argumentsList[0] === 'symbolic-ref') {
        callback(null, 'origin/trunk\n', '');
      } else if (command === 'git' && argumentsList[0] === 'status') {
        callback(null, ' M manifest.json', '');
      } else {
        callback(null, '', '');
      }
      return undefined as never;
    });
    jest
      .spyOn(fileSystem, 'readFile')
      .mockResolvedValue(JSON.stringify({ credentialWarnings: [] }));
    const adapter = new AiCliEnvAdapter(
      buildConfig({
        AI_CLI_ENV_SYNC_REPO: 'owner/snapshots',
        AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync',
      }),
    );

    await expect(adapter.exportSnapshot()).resolves.toEqual({
      changed: true,
      pushed: true,
    });

    const commandCalls = mockedExecFile.mock.calls.map(
      ([command, argumentsList]) => [command, argumentsList],
    );
    expect(commandCalls).toContainEqual(['git', ['fetch']]);
    expect(commandCalls).toContainEqual([
      'git',
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    ]);
    expect(commandCalls).toContainEqual([
      'git',
      ['reset', '--hard', 'origin/trunk'],
    ]);
    expect(
      commandCalls.filter(
        ([command, argumentsList]) =>
          command === 'node' &&
          (argumentsList as string[])[0]?.endsWith('export-ai-cli-env.cjs'),
      ),
    ).toHaveLength(2);
    expect(
      commandCalls.filter(
        ([command, argumentsList]) =>
          command === 'git' && (argumentsList as string[])[0] === 'commit',
      ),
    ).toHaveLength(2);
    expect(
      commandCalls.filter(
        ([command, argumentsList]) =>
          command === 'git' && (argumentsList as string[])[0] === 'push',
      ),
    ).toHaveLength(2);
  });

  it('push 재시도도 실패하면 예외를 전파하고 세 번째 시도는 하지 않는다', async () => {
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const [command, argumentsList] = argumentsValue as [string, string[]];
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      if (command === 'git' && argumentsList[0] === 'push') {
        callback(new Error('push failed'), '', '');
      } else if (command === 'git' && argumentsList[0] === 'symbolic-ref') {
        callback(null, 'origin/main\n', '');
      } else if (command === 'git' && argumentsList[0] === 'status') {
        callback(null, ' M manifest.json', '');
      } else {
        callback(null, '', '');
      }
      return undefined as never;
    });
    jest
      .spyOn(fileSystem, 'readFile')
      .mockResolvedValue(JSON.stringify({ credentialWarnings: [] }));
    const adapter = new AiCliEnvAdapter(
      buildConfig({
        AI_CLI_ENV_SYNC_REPO: 'owner/snapshots',
        AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync',
      }),
    );

    await expect(adapter.exportSnapshot()).rejects.toThrow('push failed');

    expect(
      mockedExecFile.mock.calls.filter(
        ([command, argumentsList]) =>
          command === 'git' && (argumentsList as string[])[0] === 'push',
      ),
    ).toHaveLength(2);
  });

  it('export manifest에 credential warning이 있으면 git 변경 확인 전에 차단한다', async () => {
    jest.spyOn(fileSystem, 'readFile').mockResolvedValue(
      JSON.stringify({
        credentialWarnings: ['claude/github', 'codex/foo'],
      }),
    );
    const adapter = new AiCliEnvAdapter(
      buildConfig({
        AI_CLI_ENV_SYNC_REPO: 'owner/snapshots',
        AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync',
      }),
    );

    await expect(adapter.exportSnapshot()).rejects.toThrow(
      /claude\/github.*codex\/foo/,
    );

    expect(mockedExecFile).not.toHaveBeenCalledWith(
      'git',
      ['status', '--porcelain'],
      expect.any(Object),
      expect.any(Function),
    );
    for (const command of ['add', 'commit', 'push']) {
      expect(
        mockedExecFile.mock.calls.some(
          ([executable, argumentsList]) =>
            executable === 'git' && (argumentsList as string[])[0] === command,
        ),
      ).toBe(false);
    }
  });

  it('bootstrap은 hooks 없이 명시적 환경만 전달하고 승인한 SHA를 적용 이력에 기록한다', async () => {
    jest
      .spyOn(fileSystem, 'readFile')
      .mockResolvedValue(
        JSON.stringify({ credentialWarnings: [], secretsRequired: [] }),
      );
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const [command, argumentsList] = argumentsValue as [string, string[]];
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const stdout =
        command === 'git' && argumentsList[0] === 'rev-parse'
          ? 'snapshot-sha\n'
          : '';
      callback(null, stdout, '');
      return undefined as never;
    });
    const adapter = new AiCliEnvAdapter(
      buildConfig({
        AI_CLI_ENV_SYNC_REPO: 'owner/snapshots',
        AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync',
      }),
    );

    await expect(adapter.applySnapshot('snapshot-sha')).resolves.toEqual({
      appliedSha: 'snapshot-sha',
      output: '',
      warnings: [],
    });

    const bootstrapCall = mockedExecFile.mock.calls.find(
      ([command, argumentsList]) =>
        command === 'node' &&
        (argumentsList as string[])[0]?.endsWith('bootstrap-ai-cli-env.cjs'),
    );
    expect(bootstrapCall?.[1]).not.toContain('--with-hooks');
    expect(bootstrapCall?.[2]).toEqual(
      expect.objectContaining({ timeout: 600_000 }),
    );
    expect((bootstrapCall?.[2] as { env?: unknown }).env).toEqual({
      HOME: homedir(),
    });
    expect(fileSystem.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.ai-cli-env-applied$/),
      expect.stringContaining('snapshot-sha'),
      'utf8',
    );
  });

  it('승인 SHA와 현재 HEAD가 다르면 bootstrap을 실행하지 않고 재승인을 요구한다', async () => {
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const [command, argumentsList] = argumentsValue as [string, string[]];
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const stdout =
        command === 'git' && argumentsList[0] === 'rev-parse'
          ? 'current7654321\n'
          : '';
      callback(null, stdout, '');
      return undefined as never;
    });
    const adapter = new AiCliEnvAdapter(
      buildConfig({ AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync' }),
    );

    let thrownError: Error | undefined;
    try {
      await adapter.applySnapshot('expected1234567');
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError?.message).toContain('expecte');
    expect(thrownError?.message).toContain('current');
    expect(thrownError?.message).not.toContain('expected1234567');
    expect(thrownError?.message).not.toContain('current7654321');
    expect(thrownError?.message).toContain('다시 승인해 주세요');

    expect(mockedExecFile).toHaveBeenCalledTimes(1);
    expect(mockedExecFile).toHaveBeenCalledWith(
      'git',
      ['rev-parse', 'HEAD'],
      expect.objectContaining({
        cwd: '/tmp/ai-cli-env-sync',
        timeout: 60_000,
      }),
      expect.any(Function),
    );
    expect(fileSystem.writeFile).not.toHaveBeenCalled();
  });

  it('sync repo가 dirty면 bootstrap을 실행하지 않는다', async () => {
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const [command, argumentsList] = argumentsValue as [string, string[]];
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const stdout =
        command === 'git' && argumentsList[0] === 'rev-parse'
          ? 'snapshot-sha\n'
          : command === 'git' && argumentsList[0] === 'status'
            ? ' M manifest.json'
            : '';
      callback(null, stdout, '');
      return undefined as never;
    });
    const adapter = new AiCliEnvAdapter(
      buildConfig({ AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync' }),
    );

    await expect(adapter.applySnapshot('snapshot-sha')).rejects.toThrow(
      /dirty|변경/i,
    );

    expect(mockedExecFile).toHaveBeenCalledTimes(2);
    expect(
      mockedExecFile.mock.calls.some(
        ([command, argumentsList]) =>
          command === 'node' &&
          (argumentsList as string[])[0]?.endsWith('bootstrap-ai-cli-env.cjs'),
      ),
    ).toBe(false);
    expect(fileSystem.writeFile).not.toHaveBeenCalled();
  });

  it('bootstrap warning이 있으면 적용 이력을 기록하지 않는다', async () => {
    jest
      .spyOn(fileSystem, 'readFile')
      .mockResolvedValue(
        JSON.stringify({ credentialWarnings: [], secretsRequired: [] }),
      );
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const [command, argumentsList] = argumentsValue as [string, string[]];
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const stdout =
        command === 'git' && argumentsList[0] === 'rev-parse'
          ? 'snapshot-sha\n'
          : command === 'node'
            ? '--- 결과 ---\n주의 1건:\n  - 일부 미적용\n\n남은 수동 작업 참고.\n'
            : '';
      callback(null, stdout, '');
      return undefined as never;
    });
    const adapter = new AiCliEnvAdapter(
      buildConfig({ AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync' }),
    );

    await expect(adapter.applySnapshot('snapshot-sha')).resolves.toEqual(
      expect.objectContaining({ warnings: ['일부 미적용'] }),
    );

    expect(fileSystem.writeFile).not.toHaveBeenCalled();
  });

  it('bootstrap env는 기본 allowlist와 manifest가 요구한 설정값만 포함한다', async () => {
    jest.spyOn(fileSystem, 'readFile').mockResolvedValue(
      JSON.stringify({
        credentialWarnings: [],
        secretsRequired: [
          { tool: 'claude', mcp: 'github', field: 'env', envKey: 'MCP_TOKEN' },
          {
            tool: 'codex',
            mcp: 'missing',
            field: 'env',
            envKey: 'MISSING_TOKEN',
          },
        ],
      }),
    );
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const [command, argumentsList] = argumentsValue as [string, string[]];
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const stdout =
        command === 'git' && argumentsList[0] === 'rev-parse'
          ? 'snapshot-sha\n'
          : command === 'node'
            ? '--- 결과 ---\n경고 없음.\n'
            : '';
      callback(null, stdout, '');
      return undefined as never;
    });
    const adapter = new AiCliEnvAdapter(
      buildConfig({
        AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync',
        PATH: '/usr/local/bin',
        USER: 'test-user',
        LANG: 'ko_KR.UTF-8',
        MCP_TOKEN: 'mcp-secret',
        SLACK_BOT_TOKEN: 'app-secret',
        DATABASE_URL: 'postgresql://app-secret',
      }),
    );

    await adapter.applySnapshot('snapshot-sha');

    const bootstrapCall = mockedExecFile.mock.calls.find(
      ([command, argumentsList]) =>
        command === 'node' &&
        (argumentsList as string[])[0]?.endsWith('bootstrap-ai-cli-env.cjs'),
    );
    expect(bootstrapCall?.[2]).toEqual(
      expect.objectContaining({
        env: {
          HOME: homedir(),
          PATH: '/usr/local/bin',
          USER: 'test-user',
          LANG: 'ko_KR.UTF-8',
          MCP_TOKEN: 'mcp-secret',
        },
      }),
    );
    expect(
      (bootstrapCall?.[2] as { env: Record<string, string> }).env,
    ).not.toHaveProperty('SLACK_BOT_TOKEN');
    expect(
      (bootstrapCall?.[2] as { env: Record<string, string> }).env,
    ).not.toHaveProperty('MISSING_TOKEN');
    expect(
      (bootstrapCall?.[2] as { env: Record<string, string> }).env,
    ).not.toHaveProperty('DATABASE_URL');
  });

  it('일반 명령 성공의 stderr를 warning 로그로 보존한다', async () => {
    jest.spyOn(fileSystem, 'stat').mockRejectedValue(new Error('not found'));
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      callback(null, '', 'git clone warning\n');
      return undefined as never;
    });
    const loggerWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const adapter = new AiCliEnvAdapter(
      buildConfig({
        AI_CLI_ENV_SYNC_REPO: 'owner/snapshots',
        AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync',
      }),
    );

    await adapter.ensureRepository();

    expect(loggerWarn).toHaveBeenCalledWith('git clone warning');
  });

  it('bootstrap 결과 구간의 주의 목록만 파싱한다', async () => {
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const [command, argumentsList] = argumentsValue as [string, string[]];
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const stdout =
        command === 'git' && argumentsList[0] === 'rev-parse'
          ? 'snapshot-sha\n'
          : command === 'git' && argumentsList[0] === 'status'
            ? ''
            : [
                '=== Claude Code ===',
                '',
                '--- 결과 ---',
                '주의 2건:',
                '  - claude CLI 없음 — 플러그인·MCP 미등록',
                '  - MCP github 건너뜀 — 환경 변수 없음: GITHUB_TOKEN',
                '',
                '남은 수동 작업은 /tmp/SECRETS-TODO.md 참고.',
                '',
              ].join('\n');
      callback(null, stdout, '');
      return undefined as never;
    });
    const adapter = new AiCliEnvAdapter(
      buildConfig({ AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync' }),
    );

    await expect(adapter.applySnapshot('snapshot-sha')).resolves.toEqual(
      expect.objectContaining({
        warnings: [
          'claude CLI 없음 — 플러그인·MCP 미등록',
          'MCP github 건너뜀 — 환경 변수 없음: GITHUB_TOKEN',
        ],
      }),
    );
  });

  it('성공한 bootstrap의 stderr도 사용자 경고로 보존한다', async () => {
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const [command, argumentsList] = argumentsValue as [string, string[]];
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      if (command === 'git' && argumentsList[0] === 'rev-parse') {
        callback(null, 'snapshot-sha\n', '');
      } else if (command === 'git' && argumentsList[0] === 'status') {
        callback(null, '', '');
      } else {
        callback(
          null,
          '--- 결과 ---\n주의 1건:\n  - 출력 경고\n\n남은 수동 작업은 TODO 참고.\n',
          'stderr 경고 1\nstderr 경고 2\n',
        );
      }
      return undefined as never;
    });
    const adapter = new AiCliEnvAdapter(
      buildConfig({ AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync' }),
    );

    await expect(adapter.applySnapshot('snapshot-sha')).resolves.toEqual(
      expect.objectContaining({
        warnings: ['출력 경고', 'stderr 경고 1', 'stderr 경고 2'],
      }),
    );
  });

  it('bootstrap 결과가 경고 없음이면 빈 warnings를 반환한다', async () => {
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const [command, argumentsList] = argumentsValue as [string, string[]];
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const stdout =
        command === 'git' && argumentsList[0] === 'rev-parse'
          ? 'snapshot-sha\n'
          : command === 'git' && argumentsList[0] === 'status'
            ? ''
            : '--- 결과 ---\n경고 없음.\n\n남은 수동 작업은 TODO 참고.\n';
      callback(null, stdout, '');
      return undefined as never;
    });
    const adapter = new AiCliEnvAdapter(
      buildConfig({ AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync' }),
    );

    await expect(adapter.applySnapshot('snapshot-sha')).resolves.toEqual(
      expect.objectContaining({ warnings: [] }),
    );
  });

  it('manifest만 있고 clone이 없으면 적용 가능한 스냅샷으로 판단하지 않는다', async () => {
    jest.spyOn(fileSystem, 'stat').mockResolvedValue({
      isDirectory: () => false,
    } as never);
    jest.spyOn(fileSystem, 'readFile').mockResolvedValue(
      JSON.stringify({
        sourceHome: '/other-machine/home',
        generatedAt: '2026-08-12T01:00:00.000Z',
      }),
    );
    const adapter = new AiCliEnvAdapter(
      buildConfig({ AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync' }),
    );

    await expect(adapter.readStatus()).resolves.toEqual({ available: false });
  });

  it('manifest의 sourceHost를 snapshot summary에 보존한다', async () => {
    jest.spyOn(fileSystem, 'stat').mockResolvedValue({
      isDirectory: () => true,
    } as never);
    jest.spyOn(fileSystem, 'readFile').mockImplementation(async (path) => {
      return String(path).endsWith('manifest.json')
        ? JSON.stringify({
            sourceHome: '/Users/same-user',
            sourceHost: 'other-mac.local',
            generatedAt: '2026-08-12T01:00:00.000Z',
          })
        : JSON.stringify({ sha: 'previous-sha' });
    });
    mockedExecFile.mockImplementation((...argumentsValue: unknown[]) => {
      const callback = argumentsValue.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      callback(null, 'snapshot-sha\n', '');
      return undefined as never;
    });
    const adapter = new AiCliEnvAdapter(
      buildConfig({ AI_CLI_ENV_SYNC_DIR: '/tmp/ai-cli-env-sync' }),
    );

    await expect(adapter.readStatus()).resolves.toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({ sourceHost: 'other-mac.local' }),
      }),
    );
  });

  it('sync 경로의 ~/ 접두사만 현재 홈 디렉터리로 확장한다', async () => {
    jest.spyOn(fileSystem, 'stat').mockRejectedValue(new Error('not found'));
    const adapter = new AiCliEnvAdapter(
      buildConfig({
        AI_CLI_ENV_SYNC_REPO: 'owner/snapshots',
        AI_CLI_ENV_SYNC_DIR: '~/.ai-cli-env-sync',
      }),
    );

    await adapter.ensureRepository();

    expect(mockedExecFile).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        'https://github.com/owner/snapshots.git',
        `${homedir()}/.ai-cli-env-sync`,
      ],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it.each(['/tmp/ai-cli-env-sync', '~other/ai-cli-env-sync'])(
    'sync 경로 %s는 그대로 보존한다',
    async (syncDirectory) => {
      jest.spyOn(fileSystem, 'stat').mockRejectedValue(new Error('not found'));
      const adapter = new AiCliEnvAdapter(
        buildConfig({
          AI_CLI_ENV_SYNC_REPO: 'owner/snapshots',
          AI_CLI_ENV_SYNC_DIR: syncDirectory,
        }),
      );

      await adapter.ensureRepository();

      expect(mockedExecFile).toHaveBeenCalledWith(
        'git',
        ['clone', 'https://github.com/owner/snapshots.git', syncDirectory],
        expect.any(Object),
        expect.any(Function),
      );
    },
  );
});
