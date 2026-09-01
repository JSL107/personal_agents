import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConsoleReadGuard } from './console-read.guard';

function contextWith(
  ip: string,
  headerToken?: string,
  host = '127.0.0.1:3099',
): ExecutionContext {
  const request = {
    ip,
    header: (name: string) => {
      const key = name.toLowerCase();
      if (key === 'x-console-token') {
        return headerToken;
      }
      if (key === 'host') {
        return host;
      }
      return undefined;
    },
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

  // DNS rebinding — 공격자가 evil.com 을 127.0.0.1 로 다시 풀리게 하면 출발지는 loopback 이
  // 되지만 Host 에는 원래 이름이 남는다. 브라우저에게는 same-origin 이라 응답까지 읽힌다.
  it('출발지가 loopback 이어도 Host 가 남의 이름이면 토큰을 요구한다', () => {
    expect(() =>
      guardWith(undefined).canActivate(
        contextWith('127.0.0.1', undefined, 'evil.example.com:3099'),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rebinding 이어도 올바른 토큰이 있으면 통과한다', () => {
    expect(
      guardWith('secret').canActivate(
        contextWith('127.0.0.1', 'secret', 'evil.example.com:3099'),
      ),
    ).toBe(true);
  });

  // 대조군 — 정상 클라이언트가 쓰는 Host 는 그대로 통과해야 한다.
  it.each([
    ['127.0.0.1:3099', '맥 앱'],
    ['localhost:8777', '개발용 serve.py'],
    ['[::1]:3002', 'IPv6 loopback'],
    ['127.0.0.1', '포트 없는 Host'],
  ])('Host %s 는 토큰 없이 통과한다 (%s)', (host) => {
    expect(
      guardWith(undefined).canActivate(
        contextWith('127.0.0.1', undefined, host),
      ),
    ).toBe(true);
  });

  it('Host 헤더가 없으면 통과시키지 않는다', () => {
    expect(() =>
      guardWith(undefined).canActivate(contextWith('127.0.0.1', undefined, '')),
    ).toThrow(ForbiddenException);
  });
});
