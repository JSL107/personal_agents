import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import type { EnqueueDeps } from '../domain/inject-queue';
import { enqueueInject } from '../domain/inject-queue';
import { LocalSessionService } from './local-session.service';

export const INJECT_ENQUEUE_DEPS = Symbol('INJECT_ENQUEUE_DEPS');

export type InjectResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'EMPTY_INSTRUCTION' | 'SESSION_NOT_FOUND';
    };

// 실 fs 바인딩. 원자적 쓰기(temp→rename)로 훅이 반쯤 쓰인 파일을 읽지 않게 한다.
export function defaultInjectEnqueueDeps(): EnqueueDeps {
  return {
    injectDir: join(homedir(), '.idaeri', 'inject'),
    now: () => Date.now(),
    seq: () => randomBytes(4).toString('hex'),
    mkdir: (dir) => {
      mkdirSync(dir, { recursive: true });
    },
    writeFile: (path, data) => {
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, data);
      renameSync(temporary, path);
    },
  };
}

@Injectable()
export class SessionInjectService {
  constructor(
    private readonly localSessions: LocalSessionService,
    @Inject(INJECT_ENQUEUE_DEPS) private readonly enqueueDeps: EnqueueDeps,
  ) {}

  inject(sessionId: string, text: string): InjectResult {
    const instruction = typeof text === 'string' ? text.trim() : '';
    if (instruction.length === 0) {
      return { ok: false, reason: 'EMPTY_INSTRUCTION' };
    }
    const found = this.localSessions
      .list()
      .find((session) => session.sessionId === sessionId);
    if (!found) {
      return { ok: false, reason: 'SESSION_NOT_FOUND' };
    }
    const written = enqueueInject(
      found.pid,
      { instruction, sessionId, source: found.source },
      this.enqueueDeps,
    );
    if (!written) {
      return { ok: false, reason: 'SESSION_NOT_FOUND' };
    }
    return { ok: true };
  }
}
