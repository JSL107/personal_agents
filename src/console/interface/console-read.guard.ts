import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import {
  isLoopbackAddress,
  isLoopbackHostHeader,
  timingSafeStringEqual,
} from '../../common/guard/loopback.util';

// 콘솔 관제 read 게이트 (REST 스냅샷·원장·브리핑 + SSE 스트림).
//
// write 와 정책이 다른 이유: read 는 **원격에서 써야 한다**. 윈도우 PC 의 오피스 화면이
// 같은 공유기(192.168.x.x) 나 Tailscale(100.x.x.x) 주소로 붙어 스냅샷과 스트림을 읽는다.
// 그래서 loopback 강제가 아니라 "원격이면 토큰" 이다.
//
// 토큰 미설정 + 원격 = **거부**(fail-closed). 미설정을 통과로 두면 env 를 안 채운 동안
// 조용히 열려 있게 되는데, 여기로 나가는 것이 세션 cwd·pid 와 워커 산출물 전문이라
// (`command.answered` 이벤트) 기본값이 닫힘이어야 한다.
//
// loopback 을 토큰 없이 통과시키는 것은 기존 로컬 사용을 깨지 않기 위해서다 — 맥 앱은
// 읽기 요청에 토큰을 싣지 않고(`ConsoleClient.fetchSnapshot`), 개발용 `serve.py` 프록시도
// 마찬가지다. 둘 다 같은 머신에서만 돈다.
@Injectable()
export class ConsoleReadGuard implements CanActivate {
  private readonly logger = new Logger(ConsoleReadGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // 출발지가 loopback 이라도 Host 가 남의 이름이면 DNS rebinding 이다 — 토큰을 받게 둔다.
    if (
      isLoopbackAddress(request.ip) &&
      isLoopbackHostHeader(request.header('host'))
    ) {
      return true;
    }

    const expected = this.config.get<string>('CONSOLE_REMOTE_TOKEN');
    if (!expected) {
      // 외부 응답에는 env 변수명을 노출하지 않는다(정찰 차단). 운영 진단은 logger 로만.
      this.logger.warn(
        'CONSOLE_REMOTE_TOKEN 미설정 — 원격 콘솔 read 요청을 거부합니다.',
      );
      throw new ForbiddenException(
        '원격에서 콘솔을 읽으려면 토큰이 필요합니다.',
      );
    }

    const provided = request.header('x-console-token') ?? '';
    if (!timingSafeStringEqual(provided, expected)) {
      throw new UnauthorizedException('콘솔 토큰이 유효하지 않습니다.');
    }
    return true;
  }
}
