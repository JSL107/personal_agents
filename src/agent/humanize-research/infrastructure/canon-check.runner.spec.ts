import { EventEmitter } from 'node:events';

import { ConfigService } from '@nestjs/config';

import {
  HumanizeResearchProposal,
  ProposalSkipReason,
  ProposalTarget,
} from '../domain/humanize-research.type';

const QUICK_RULE_ROW =
  '| A-8 | 이중 피동 "~되어진다" | S1 | 능동 또는 단일 피동 ("판단되어진다" → "판단된다") |';
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

    expect(result).toEqual({ reason: null, baseSha: HEAD });
    expect(spawnPython).toHaveBeenCalledWith(
      'python3',
      ['references/metrics_v2.py', '--selfcheck'],
      { cwd: TEMP_DIRECTORY, shell: false, stdio: 'ignore', timeout: 60_000 },
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
    expect(writeFile).not.toHaveBeenCalled();
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
});
