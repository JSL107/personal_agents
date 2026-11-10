import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fileSystem from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import * as cliProcessUtil from '../../model-router/infrastructure/cli-process.util';
import { AiWeeklyPeriod } from '../domain/ai-weekly-period';
import { AiWeeklyMetricsRunner } from './ai-weekly-metrics.runner';

let spawnMock: jest.SpyInstance;
let existsMock: jest.SpyInstance;
let killMock: jest.SpyInstance;

const period: AiWeeklyPeriod = {
  since: new Date('2026-11-01T15:00:00Z'),
  until: new Date('2026-11-08T15:00:00Z'),
  prevSince: new Date('2026-10-25T15:00:00Z'),
};

const child = () => {
  const process = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
  };
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.pid = 123;
  spawnMock.mockReturnValue(process);
  return process;
};

describe('AiWeeklyMetricsRunner', () => {
  beforeEach(() => {
    spawnMock = jest.spyOn(childProcess, 'spawn');
    existsMock = jest.spyOn(fileSystem, 'existsSync').mockReturnValue(true);
    killMock = jest
      .spyOn(cliProcessUtil, 'killProcessTree')
      .mockImplementation();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('정상 JSON을 반환하고 격리된 spawn 옵션을 쓴다', async () => {
    const fakeChild = child();
    const result = new AiWeeklyMetricsRunner().run(period);
    fakeChild.stdout.write('{"version":1}');
    fakeChild.emit('close', 0);
    await expect(result).resolves.toEqual({ version: 1 });
    const [command, argumentsList, options] = spawnMock.mock.calls[0];
    expect(command).toBe('python3');
    expect(argumentsList).toEqual(
      expect.arrayContaining(['-I', '-B', '--since']),
    );
    expect(argumentsList[2]).toBe(
      join(process.cwd(), 'scripts', 'ai-weekly-metrics.py'),
    );
    expect(options).toMatchObject({
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { HOME: cliProcessUtil.getRealHomeDir() },
    });
  });

  it('스크립트 오류의 첫 코드만 노출한다', async () => {
    const process = child();
    const result = new AiWeeklyMetricsRunner().run(period);
    process.stderr.write('AIWM_ERROR INTERNAL\nPII_MARKER_7f3a');
    process.emit('close', 3);
    await expect(result).rejects.toThrow('exit=3 code=INTERNAL');
  });

  it('알 수 없는 오류 코드는 UNKNOWN으로 제한한다', async () => {
    const process = child();
    const result = new AiWeeklyMetricsRunner().run(period);
    process.stderr.write('AIWM_ERROR FOO_BAR');
    process.emit('close', 3);
    await expect(result).rejects.toThrow('exit=3 code=UNKNOWN');
  });

  it('잘못된 JSON 원문은 예외 메시지에 넣지 않는다', async () => {
    const process = child();
    const result = new AiWeeklyMetricsRunner().run(period);
    process.stdout.write('{bad');
    process.emit('close', 0);
    await expect(result).rejects.toThrow('exit=0 code=BAD_JSON');
  });

  it('UTF-8 문자가 청크 경계에서 나뉘어도 JSON을 읽는다', async () => {
    const fakeChild = child();
    const result = new AiWeeklyMetricsRunner().run(period);
    const encoded = Buffer.from('{"text":"한"}');
    const splitIndex = encoded.indexOf(Buffer.from('한')) + 1;
    fakeChild.stdout.write(encoded.subarray(0, splitIndex));
    fakeChild.stdout.write(encoded.subarray(splitIndex));
    fakeChild.emit('close', 0);
    await expect(result).resolves.toEqual({ text: '한' });
  });

  it('stdout 상한을 넘으면 프로세스 그룹을 종료한다', async () => {
    const process = child();
    const result = new AiWeeklyMetricsRunner().run(period);
    process.stdout.write('x'.repeat(1_048_577));
    process.emit('close', null);
    await expect(result).rejects.toThrow('code=OUTPUT_TOO_LARGE');
    expect(killMock).toHaveBeenCalledWith(123);
  });

  it('시간 제한을 넘으면 프로세스 그룹을 종료한다', async () => {
    jest.useFakeTimers();
    try {
      const process = child();
      const result = new AiWeeklyMetricsRunner().run(period);
      jest.advanceTimersByTime(120_000);
      process.emit('close', null);
      await expect(result).rejects.toThrow('code=TIMEOUT');
      expect(killMock).toHaveBeenCalledWith(123);
    } finally {
      jest.useRealTimers();
    }
  });

  it('스크립트가 없으면 spawn 전에 SCRIPT_MISSING을 낸다', async () => {
    existsMock.mockReturnValue(false);
    await expect(new AiWeeklyMetricsRunner().run(period)).rejects.toThrow(
      'exit=none code=SCRIPT_MISSING',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
