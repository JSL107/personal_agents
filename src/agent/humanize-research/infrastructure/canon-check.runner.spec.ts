import { EventEmitter } from 'node:events';

import { ConfigService } from '@nestjs/config';

import {
  HumanizeResearchProposal,
  ProposalSkipReason,
  ProposalTarget,
} from '../domain/humanize-research.type';

const QUICK_RULE_ROW =
  '| A-8 | 이중 피동 "~되어진다" | S1 | 능동 또는 단일 피동 ("판단되어진다" → "판단된다") |';
const NEXT_RULE_ROW =
  '| A-9 | "~에 의해" 피동 | S2 | 행위자를 주어로("AI에 의해 생성" → "AI가 만든") |';
const HEAD = 'a'.repeat(40);
const TEMP_DIRECTORY = '/tmp/humanize-canon-test';
const proposal: HumanizeResearchProposal = {
  target: ProposalTarget.CANON,
  file: 'references/quick-rules.md',
  oldString: QUICK_RULE_ROW,
  newString: QUICK_RULE_ROW.replace('S1', 'S2'),
  targetMetric: 'A-8 severity',
  rationale: '실측 근거',
  evidence: ['canon:abc'],
};

const git = jest.fn();
const readFile = jest.fn();
const writeFile = jest.fn();
const makeTemp = jest.fn();
const readDirectory = jest.fn();
const remove = jest.fn();
const spawnPython = jest.fn();

let CanonCheckRunner: typeof import('./canon-check.runner').CanonCheckRunner;

describe('CanonCheckRunner', () => {
  const configService = {
    get: jest.fn().mockReturnValue('/tmp/humanize-repository'),
  } as unknown as ConfigService;

  beforeEach(async () => {
    jest.resetModules();
    jest.doMock('./collectors/upstream-rule-diff.collector', () => ({
      runGit: git,
    }));
    jest.doMock('node:fs/promises', () => ({
      mkdtemp: makeTemp,
      readFile,
      writeFile,
      readdir: readDirectory,
      rm: remove,
    }));
    jest.doMock('node:child_process', () => ({ spawn: spawnPython }));
    ({ CanonCheckRunner } = await import('./canon-check.runner'));
    git.mockReset();
    git.mockImplementation(async ({ args }: { args: string[] }) => ({
      exitCode: 0,
      stdout: args[0] === 'rev-parse' ? `${HEAD}\n` : '',
      stderr: '',
    }));
    readFile.mockReset().mockResolvedValue(`앞\n${QUICK_RULE_ROW}\n뒤`);
    writeFile.mockReset().mockResolvedValue(undefined);
    makeTemp.mockReset().mockResolvedValue(TEMP_DIRECTORY);
    readDirectory.mockReset().mockResolvedValue([
      { name: 'fixture-b', isDirectory: () => true },
      { name: 'fixture-a', isDirectory: () => true },
    ]);
    remove.mockReset().mockResolvedValue(undefined);
    pythonExitCodes([0, 0, 0, 2, 0, 1]);
  });

  const pythonExitCodes = (codes: number[]): void => {
    spawnPython.mockReset();
    for (const code of codes) {
      spawnPython.mockImplementationOnce(() => {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('close', code));
        return child;
      });
    }
  };

  it('selfcheck 실패면 SELFCHECK_FAILED 를 반환하고 worktree 를 제거한다', async () => {
    pythonExitCodes([1]);
    const runner = new CanonCheckRunner(configService);

    const result = await runner.check(proposal);

    expect(result).toEqual({
      reason: ProposalSkipReason.SELFCHECK_FAILED,
      baseSha: HEAD,
      ruleIds: [],
    });
    expect(git).toHaveBeenCalledWith({
      directory: '/tmp/humanize-repository',
      args: ['worktree', 'remove', '--force', TEMP_DIRECTORY],
    });
  });

  it('severity sync 실패면 SEVERITY_SYNC_FAILED 를 반환한다', async () => {
    pythonExitCodes([0, 1]);
    const runner = new CanonCheckRunner(configService);

    const result = await runner.check(proposal);

    expect(result.reason).toBe(ProposalSkipReason.SEVERITY_SYNC_FAILED);
  });

  it('golden 종료 코드가 0 2 0 1 과 다르면 GOLDEN_FAILED 를 반환한다', async () => {
    pythonExitCodes([0, 0, 0, 0, 0, 1]);
    const runner = new CanonCheckRunner(configService);

    const result = await runner.check(proposal);

    expect(result.reason).toBe(ProposalSkipReason.GOLDEN_FAILED);
    expect(git).toHaveBeenCalledWith({
      directory: '/tmp/humanize-repository',
      args: ['worktree', 'remove', '--force', TEMP_DIRECTORY],
    });
  });

  it('모든 검사를 통과하면 fetch 뒤 origin/main SHA 를 반환한다', async () => {
    const runner = new CanonCheckRunner(configService);

    const result = await runner.check(proposal);

    expect(result).toEqual({ reason: null, baseSha: HEAD, ruleIds: ['A-8'] });
    const expectedOptions = expect.objectContaining({
      cwd: TEMP_DIRECTORY,
      env: expect.objectContaining({
        HOME: TEMP_DIRECTORY,
        PYTHONUTF8: '1',
      }),
      shell: false,
      stdio: 'ignore',
      timeout: 60_000,
    });
    expect(spawnPython).toHaveBeenCalledWith(
      'python3',
      ['references/metrics_v2.py', '--selfcheck'],
      expectedOptions,
    );
    expect(git.mock.calls.map(([input]) => input.args)).toEqual([
      ['fetch', 'origin'],
      ['rev-parse', 'origin/main'],
      ['worktree', 'add', '--detach', TEMP_DIRECTORY, HEAD],
      ['worktree', 'remove', '--force', TEMP_DIRECTORY],
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      `${TEMP_DIRECTORY}/references/quick-rules.md`,
      `앞\n${proposal.newString}\n뒤`,
      'utf8',
    );
    expect(spawnPython.mock.calls.map(([, args]) => args)).toEqual([
      ['references/metrics_v2.py', '--selfcheck'],
      ['scripts/check_severity_sync.py'],
      [
        'scripts/verify_gates.py',
        '--before',
        'tests/golden/fixtures/fixture-a/input.txt',
        '--after',
        'tests/golden/fixtures/fixture-a/good_output.txt',
        '--genre',
        'essay',
      ],
      [
        'scripts/verify_gates.py',
        '--before',
        'tests/golden/fixtures/fixture-a/input.txt',
        '--after',
        'tests/golden/fixtures/fixture-a/bad_output.txt',
        '--genre',
        'essay',
      ],
      [
        'scripts/verify_gates.py',
        '--before',
        'tests/golden/fixtures/fixture-b/input.txt',
        '--after',
        'tests/golden/fixtures/fixture-b/good_output.txt',
        '--genre',
        'essay',
      ],
      [
        'scripts/verify_gates.py',
        '--before',
        'tests/golden/fixtures/fixture-b/input.txt',
        '--after',
        'tests/golden/fixtures/fixture-b/bad_output.txt',
        '--genre',
        'essay',
      ],
    ]);
  });

  it('origin/main 에 기존 문구가 유일하지 않으면 MATCH_NOT_UNIQUE 를 반환한다', async () => {
    readFile.mockResolvedValue(`${QUICK_RULE_ROW}\n${QUICK_RULE_ROW}`);
    const runner = new CanonCheckRunner(configService);

    const result = await runner.check(proposal);

    expect(result.reason).toBe(ProposalSkipReason.MATCH_NOT_UNIQUE);
    expect(result.ruleIds).toEqual([]);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('검사한 SHA의 두 규칙 행에 걸친 문구면 두 ID를 반환한다', async () => {
    const oldString = `${QUICK_RULE_ROW}\n${NEXT_RULE_ROW}`;
    readFile.mockResolvedValue(`앞\n${oldString}\n뒤`);
    const runner = new CanonCheckRunner(configService);

    const result = await runner.check({ ...proposal, oldString });

    expect(result).toEqual({
      reason: null,
      baseSha: HEAD,
      ruleIds: ['A-8', 'A-9'],
    });
  });

  it('검사 도중 throw 되어도 worktree 를 제거한다', async () => {
    readFile.mockRejectedValue(new Error('read failed'));
    const runner = new CanonCheckRunner(configService);

    await expect(runner.check(proposal)).rejects.toThrow('read failed');
    expect(git).toHaveBeenCalledWith({
      directory: '/tmp/humanize-repository',
      args: ['worktree', 'remove', '--force', TEMP_DIRECTORY],
    });
  });

  it('python 이 signal 로 종료되면 검사 실패로 분류하지 않고 throw 한다', async () => {
    spawnPython.mockReset().mockImplementationOnce(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      return child;
    });
    const runner = new CanonCheckRunner(configService);

    await expect(runner.check(proposal)).rejects.toThrow('python3 실행 실패');
    expect(git).toHaveBeenCalledWith({
      directory: '/tmp/humanize-repository',
      args: ['worktree', 'remove', '--force', TEMP_DIRECTORY],
    });
  });

  it('worktree 제거가 실패하면 폴더 삭제 후 등록 정보를 prune 한다', async () => {
    git.mockImplementation(async ({ args }: { args: string[] }) => ({
      exitCode: args[0] === 'worktree' && args[1] === 'remove' ? 1 : 0,
      stdout: args[0] === 'rev-parse' ? `${HEAD}\n` : '',
      stderr: 'remove failed',
    }));
    pythonExitCodes([1]);
    const runner = new CanonCheckRunner(configService);

    await runner.check(proposal);

    expect(remove).toHaveBeenCalledWith(TEMP_DIRECTORY, {
      recursive: true,
      force: true,
    });
    expect(git).toHaveBeenLastCalledWith({
      directory: '/tmp/humanize-repository',
      args: ['worktree', 'prune'],
    });
  });

  it('worktree prune 실패는 경고만 남기고 검사 결과를 유지한다', async () => {
    git.mockImplementation(async ({ args }: { args: string[] }) => ({
      exitCode: args[0] === 'worktree' && args[1] !== 'add' ? 1 : 0,
      stdout: args[0] === 'rev-parse' ? `${HEAD}\n` : '',
      stderr: 'worktree failed',
    }));
    pythonExitCodes([1]);
    const runner = new CanonCheckRunner(configService);
    const { Logger } = await import('@nestjs/common');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    try {
      const result = await runner.check(proposal);

      expect(result.reason).toBe(ProposalSkipReason.SELFCHECK_FAILED);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('정본 worktree 등록 정리 실패'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('동시 검사에서 첫 worktree 제거가 끝난 뒤 두 번째 fetch 를 시작한다', async () => {
    let releaseFetch: () => void = () => undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let releaseRemove: () => void = () => undefined;
    const removeGate = new Promise<void>((resolve) => {
      releaseRemove = resolve;
    });
    let markRemoveEntered: () => void = () => undefined;
    const removeEntered = new Promise<void>((resolve) => {
      markRemoveEntered = resolve;
    });
    let fetchCount = 0;
    let removeCount = 0;
    git.mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === 'fetch') {
        fetchCount += 1;
        if (fetchCount === 1) {
          await fetchGate;
        }
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        removeCount += 1;
        if (removeCount === 1) {
          markRemoveEntered();
          await removeGate;
        }
      }
      return {
        exitCode: 0,
        stdout: args[0] === 'rev-parse' ? `${HEAD}\n` : '',
        stderr: '',
      };
    });
    pythonExitCodes([1, 1]);
    const runner = new CanonCheckRunner(configService);

    const first = runner.check(proposal);
    const second = runner.check(proposal);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const fetchCallsDuringFirstFetch = git.mock.calls.filter(
      ([input]) => input.args[0] === 'fetch',
    );
    expect(fetchCallsDuringFirstFetch).toHaveLength(1);
    releaseFetch();
    await removeEntered;
    const fetchCallsBeforeRemove = git.mock.calls.filter(
      ([input]) => input.args[0] === 'fetch',
    );
    expect(fetchCallsBeforeRemove).toHaveLength(1);
    releaseRemove();
    await Promise.all([first, second]);
    const fetchCallsAfterRemove = git.mock.calls.filter(
      ([input]) => input.args[0] === 'fetch',
    );
    expect(fetchCallsAfterRemove).toHaveLength(2);
  });

  it('첫 검사가 실패해도 대기 중인 다음 검사는 실행된다', async () => {
    git.mockRejectedValueOnce(new Error('fetch failed'));
    pythonExitCodes([1]);
    const runner = new CanonCheckRunner(configService);

    const first = runner.check(proposal);
    const second = runner.check(proposal);

    await expect(first).rejects.toThrow('fetch failed');
    await expect(second).resolves.toEqual({
      reason: ProposalSkipReason.SELFCHECK_FAILED,
      baseSha: HEAD,
      ruleIds: [],
    });
  });

  it('PATH 설정이 없으면 Python 에 기본 경로만 전달한다', async () => {
    const configWithoutPath = {
      get: jest.fn((key: string) => {
        if (key === 'PATH') {
          return undefined;
        }
        return '/tmp/humanize-repository';
      }),
    } as unknown as ConfigService;
    pythonExitCodes([1]);
    const runner = new CanonCheckRunner(configWithoutPath);

    await runner.check(proposal);

    const spawnOptions = spawnPython.mock.calls[0][2];
    expect(spawnOptions.env).toEqual({
      PATH: '/usr/bin:/bin',
      PYTHONUTF8: '1',
      HOME: TEMP_DIRECTORY,
    });
  });

  it('python 자식 환경에 부모의 임의 비밀 키를 전달하지 않는다', async () => {
    const secretKey = 'HUMANIZE_TEST_SECRET';
    process.env[secretKey] = 'do-not-forward';
    pythonExitCodes([1]);
    const runner = new CanonCheckRunner(configService);

    try {
      await runner.check(proposal);
      const spawnOptions = spawnPython.mock.calls[0][2];
      expect(Object.keys(spawnOptions.env).sort()).toEqual([
        'HOME',
        'PATH',
        'PYTHONUTF8',
      ]);
      expect(spawnOptions.env[secretKey]).toBeUndefined();
      expect(spawnOptions.env.PYTHONUTF8).toBe('1');
      expect(spawnOptions.env.HOME).toBe(TEMP_DIRECTORY);
      expect(spawnOptions.env.PATH).toBe('/tmp/humanize-repository');
    } finally {
      delete process.env[secretKey];
    }
  });
});
