import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConsoleWriteGuard } from './console-write.guard';

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

function guardWith(token?: string): ConsoleWriteGuard {
  const config = {
    get: (key: string) => (key === 'CONSOLE_REMOTE_TOKEN' ? token : undefined),
  };
  return new ConsoleWriteGuard(config as unknown as ConfigService);
}

describe('ConsoleWriteGuard', () => {
  it('loopback + 토큰 미설정이면 통과한다', () => {
    expect(guardWith(undefined).canActivate(contextWith('127.0.0.1'))).toBe(
      true,
    );
  });

  it('loopback 이 아니면 ForbiddenException', () => {
    expect(() =>
      guardWith(undefined).canActivate(contextWith('192.168.0.5')),
    ).toThrow(ForbiddenException);
  });

  it('토큰 설정 + 일치하면 통과한다', () => {
    expect(guardWith('secret').canActivate(contextWith('::1', 'secret'))).toBe(
      true,
    );
  });

  it('토큰 설정 + 불일치면 UnauthorizedException', () => {
    expect(() =>
      guardWith('secret').canActivate(contextWith('127.0.0.1', 'nope')),
    ).toThrow(UnauthorizedException);
  });
});
