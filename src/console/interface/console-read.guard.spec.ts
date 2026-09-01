import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConsoleReadGuard } from './console-read.guard';

function contextWith(ip: string, headerToken?: string): ExecutionContext {
  const request = {
    ip,
    header: (name: string) =>
      name.toLowerCase() === 'x-console-token' ? headerToken : undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardWith(token?: string): ConsoleReadGuard {
  const config = {
    get: (key: string) => (key === 'CONSOLE_REMOTE_TOKEN' ? token : undefined),
  };
  return new ConsoleReadGuard(config as unknown as ConfigService);
}

describe('ConsoleReadGuard', () => {
  // 로컬 사용을 깨지 않는 것이 이 가드의 전제다 — 맥 앱과 serve.py 는 읽기에 토큰을 싣지 않는다.
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'loopback(%s)은 토큰 없이 통과한다',
    (ip) => {
      expect(guardWith(undefined).canActivate(contextWith(ip))).toBe(true);
    },
  );

  it('원격 + 토큰 미설정이면 거부한다 (fail-closed)', () => {
    expect(() =>
      guardWith(undefined).canActivate(contextWith('192.168.0.5')),
    ).toThrow(ForbiddenException);
  });

  it('원격 + 토큰 불일치면 UnauthorizedException', () => {
    expect(() =>
      guardWith('secret').canActivate(contextWith('192.168.0.5', 'nope')),
    ).toThrow(UnauthorizedException);
  });

  it('원격 + 토큰 누락이면 UnauthorizedException', () => {
    expect(() =>
      guardWith('secret').canActivate(contextWith('100.101.102.103')),
    ).toThrow(UnauthorizedException);
  });

  it('원격 + 토큰 일치면 통과한다', () => {
    expect(
      guardWith('secret').canActivate(contextWith('192.168.0.5', 'secret')),
    ).toBe(true);
  });

  it('토큰이 접두사만 같아도 거부한다', () => {
    expect(() =>
      guardWith('secret').canActivate(contextWith('192.168.0.5', 'sec')),
    ).toThrow(UnauthorizedException);
  });
});
