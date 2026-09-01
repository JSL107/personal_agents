import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LoopbackOnlyGuard } from './loopback-only.guard';

function contextWith(
  ip: string,
  headerToken?: string,
  fetchSite?: string,
): ExecutionContext {
  const request = {
    ip,
    header: (name: string) => {
      const key = name.toLowerCase();
      if (key === 'x-console-token') {
        return headerToken;
      }
      if (key === 'sec-fetch-site') {
        return fetchSite;
      }
      return undefined;
    },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardWith(token?: string): LoopbackOnlyGuard {
  const config = {
    get: (key: string) => (key === 'CONSOLE_REMOTE_TOKEN' ? token : undefined),
  };
  return new LoopbackOnlyGuard(config as unknown as ConfigService);
}

describe('LoopbackOnlyGuard', () => {
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

  // CSRF — 출발지가 loopback 이어도 브라우저가 다른 사이트에서 쏜 것은 사용자의 의도가 아니다.
  // 악성 페이지가 `http://127.0.0.1:3099/...` 로 form 을 제출하면 source IP 는 loopback 이다.
  it('loopback 이어도 cross-site 브라우저 요청은 거부한다', () => {
    expect(() =>
      guardWith(undefined).canActivate(
        contextWith('127.0.0.1', undefined, 'cross-site'),
      ),
    ).toThrow(ForbiddenException);
  });

  it('same-site 도 다른 출처다 — 거부한다', () => {
    expect(() =>
      guardWith(undefined).canActivate(
        contextWith('127.0.0.1', undefined, 'same-site'),
      ),
    ).toThrow(ForbiddenException);
  });

  // 대조군 — 막기만 하면 정상 경로가 죽은 것도 초록으로 보인다.
  it.each([
    ['same-origin', '앱 자신이 띄운 화면'],
    ['none', '주소창에 직접 입력'],
  ])('Sec-Fetch-Site: %s 는 통과한다 (%s)', (site) => {
    expect(
      guardWith(undefined).canActivate(
        contextWith('127.0.0.1', undefined, site),
      ),
    ).toBe(true);
  });

  it('헤더가 없으면 브라우저가 아니다 — 통과한다', () => {
    expect(guardWith(undefined).canActivate(contextWith('127.0.0.1'))).toBe(
      true,
    );
  });
});
