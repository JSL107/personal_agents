import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

// 서버 로그를 파일로도 남긴다. 앱이 터미널(tty)에 붙어 뜨면 stdout 이 화면으로만 가서 창을
// 닫거나 스크롤이 밀리면 사라진다 — 2026-09 조사 때 실행 중 프로세스의 fd1/fd2 가 /dev/ttys0xx
// 였고 파일 로그는 09-11 이후 없었다. 그래서 `swept: stale IN_PROGRESS` 가 강제 종료인지 매달림인지
// 가를 근거가 없었다.
//
// 동기 쓰기(writeSync)를 쓰는 이유: 비동기 스트림은 크래시 직전 버퍼가 날아간다. 죽기 직전
// 로그가 가장 필요한 로그다. 로그 양이 적어(초당 수 줄) 동기 비용은 무시할 수준이다.

// Nest ConsoleLogger 가 tty 에서 붙이는 색상 코드. 파일에서는 grep 을 방해할 뿐이다.
// eslint-disable-next-line no-control-regex
const ANSI_COLOR_PATTERN = /\x1b\[[0-9;]*m/g;

export class RotatingFileLog {
  private fd: number;
  private size: number;

  constructor(
    private readonly filePath: string,
    private readonly maxBytes: number,
    // 현재 파일 포함 보관 개수. 5 면 server.log + server.log.1~4.
    private readonly maxFiles: number,
  ) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.size = existsSync(filePath) ? statSync(filePath).size : 0;
    this.fd = openSync(filePath, 'a');
  }

  write(chunk: string | Uint8Array): void {
    const text =
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    const buffer = Buffer.from(text.replace(ANSI_COLOR_PATTERN, ''), 'utf8');
    if (this.size > 0 && this.size + buffer.length > this.maxBytes) {
      this.rotate();
    }
    writeSync(this.fd, buffer);
    this.size += buffer.length;
  }

  private rotate(): void {
    closeSync(this.fd);
    const oldest = `${this.filePath}.${this.maxFiles - 1}`;
    if (existsSync(oldest)) {
      unlinkSync(oldest);
    }
    for (let index = this.maxFiles - 2; index >= 1; index -= 1) {
      const from = `${this.filePath}.${index}`;
      if (existsSync(from)) {
        renameSync(from, `${this.filePath}.${index + 1}`);
      }
    }
    renameSync(this.filePath, `${this.filePath}.1`);
    this.fd = openSync(this.filePath, 'a');
    this.size = 0;
  }
}

type WriteFn = NodeJS.WriteStream['write'];

/**
 * stdout·stderr 에 쓰이는 모든 것을 파일에도 복사한다. **원래 출력이 먼저이고 항상 나간다** —
 * 파일 쓰기가 실패해도 화면 로그는 그대로다. 첫 실패 때 한 줄 알리고 파일 복사를 끈다.
 * ponytail: 끈 뒤 재시도하지 않는다(디스크가 다시 비어도 재시작 전까지 파일 로그 없음) — 필요해지면
 * 일정 시간 뒤 재개로 바꾼다.
 */
export const teeStreamsToFile = (
  log: Pick<RotatingFileLog, 'write'>,
  streams: NodeJS.WriteStream[],
): void => {
  let disabled = false;
  for (const stream of streams) {
    const original = stream.write.bind(stream) as WriteFn;
    stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      const written = (original as (...args: unknown[]) => boolean)(
        chunk,
        ...rest,
      );
      if (!disabled) {
        try {
          log.write(chunk);
        } catch (error: unknown) {
          disabled = true;
          const message =
            error instanceof Error ? error.message : String(error);
          (original as (text: string) => boolean)(
            `[file-log] 파일 로그 쓰기 실패 — 이후 파일 기록을 끈다 (화면 출력은 유지): ${message}\n`,
          );
        }
      }
      return written;
    }) as WriteFn;
  }
};
