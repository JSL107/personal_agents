import {
  SandboxRunnerPort,
  SandboxRunRequest,
  SandboxRunResult,
} from '../domain/port/sandbox-runner.port';
import { RunSandboxUsecase } from './run-sandbox.usecase';

const buildResult = (
  overrides: Partial<SandboxRunResult> = {},
): SandboxRunResult => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  durationMs: 100,
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  ...overrides,
});

const buildRunner = (
  result: SandboxRunResult,
): jest.Mocked<SandboxRunnerPort> => ({
  run: jest.fn().mockResolvedValue(result),
});

describe('RunSandboxUsecase', () => {
  it('runner.run 에 req 를 그대로 위임하고 결과를 반환한다', async () => {
    const expected = buildResult({ exitCode: 0, stdout: 'ok' });
    const runner = buildRunner(expected);
    const usecase = new RunSandboxUsecase(runner);

    const req: SandboxRunRequest = {
      command: 'pnpm test',
      hostMountPath: '/tmp/repo',
    };

    const result = await usecase.execute(req);

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith(req);
    expect(result).toBe(expected);
  });

  it('runner.run 이 reject 하면 예외를 그대로 전파한다', async () => {
    const runner: jest.Mocked<SandboxRunnerPort> = {
      run: jest.fn().mockRejectedValue(new Error('docker failed')),
    };
    const usecase = new RunSandboxUsecase(runner);

    await expect(
      usecase.execute({ command: 'echo', hostMountPath: '/tmp/repo' }),
    ).rejects.toThrow('docker failed');
  });
});
