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
  });

  it('bootstrap은 hooks 없이 현재 환경을 상속하고 승인한 SHA를 적용 이력에 기록한다', async () => {
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
    expect((bootstrapCall?.[2] as { env?: unknown }).env).toBeUndefined();
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
