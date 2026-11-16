import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';

const spawnGit = jest.fn();
let runGit: typeof import('./upstream-rule-diff.collector').runGit;

const fakeChild = (): EventEmitter => {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: jest.Mock };
    stderr: EventEmitter & { setEncoding: jest.Mock };
  };
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: jest.fn() });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: jest.fn() });
  queueMicrotask(() => child.emit('close', 0));
  return child;
};

describe('runGit', () => {
  const secretKey = 'HUMANIZE_TEST_SECRET';

  beforeEach(async () => {
    jest.resetModules();
    spawnGit.mockReset();
    spawnGit.mockImplementation(fakeChild);
    jest.doMock('node:child_process', () => ({ spawn: spawnGit }));
    ({ runGit } = await import('./upstream-rule-diff.collector'));
    process.env[secretKey] = 'leak';
  });

  afterEach(() => {
    delete process.env[secretKey];
  });

  it('부모 env 를 넘기지 않고 실제 HOME 만 git 에 준다', async () => {
    await runGit({ directory: '/repo', args: ['fetch', 'origin'] });

    const options = spawnGit.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    const realHome = homedir();
    expect(options.env[secretKey]).toBeUndefined();
    expect(options.env.HOME).toBe(realHome);
  });
});
