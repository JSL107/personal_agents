import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RotatingFileLog, teeStreamsToFile } from './rotating-file-log';

describe('RotatingFileLog', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rotating-file-log-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('상한을 넘기면 회전하고 보관 개수를 넘는 가장 오래된 파일은 지운다', () => {
    const filePath = join(dir, 'logs', 'server.log');
    const log = new RotatingFileLog(filePath, 10, 3);

    log.write('aaaaaaaa\n'); // 9B
    log.write('bbbbbbbb\n'); // 18B 가 되므로 회전 → a 는 .1
    log.write('cccccccc\n'); // 회전 → a 는 .2, b 는 .1
    log.write('dddddddd\n'); // 회전 → a 는 삭제(보관 3개), b .2, c .1

    expect(readFileSync(filePath, 'utf8')).toBe('dddddddd\n');
    expect(readFileSync(`${filePath}.1`, 'utf8')).toBe('cccccccc\n');
    expect(readFileSync(`${filePath}.2`, 'utf8')).toBe('bbbbbbbb\n');
    expect(existsSync(`${filePath}.3`)).toBe(false);
  });

  it('색상 코드는 걷어내고 적는다', () => {
    const filePath = join(dir, 'server.log');
    const log = new RotatingFileLog(filePath, 1_000, 2);

    log.write('\x1b[32mLOG\x1b[39m 부팅\n');

    expect(readFileSync(filePath, 'utf8')).toBe('LOG 부팅\n');
  });
});

describe('teeStreamsToFile', () => {
  const buildStream = (): {
    stream: NodeJS.WriteStream;
    printed: string[];
  } => {
    const printed: string[] = [];
    const stream = {
      write: (chunk: string) => {
        printed.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    return { stream, printed };
  };

  it('원래 출력과 파일에 모두 쓴다', () => {
    const { stream, printed } = buildStream();
    const log = { write: jest.fn() };

    teeStreamsToFile(log, [stream]);
    stream.write('hello\n');

    expect(printed).toEqual(['hello\n']);
    expect(log.write).toHaveBeenCalledWith('hello\n');
  });

  it('파일 쓰기가 실패해도 원래 출력은 유지하고, 한 번 알린 뒤 파일 기록을 끈다', () => {
    const { stream, printed } = buildStream();
    const log = {
      write: jest.fn(() => {
        throw new Error('ENOSPC');
      }),
    };

    teeStreamsToFile(log, [stream]);
    stream.write('first\n');
    stream.write('second\n');

    expect(printed[0]).toBe('first\n');
    expect(printed[1]).toContain('파일 로그 쓰기 실패');
    expect(printed[1]).toContain('ENOSPC');
    expect(printed[2]).toBe('second\n');
    expect(printed).toHaveLength(3);
    expect(log.write).toHaveBeenCalledTimes(1);
  });
});
