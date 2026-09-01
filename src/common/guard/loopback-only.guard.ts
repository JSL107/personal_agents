import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import {
  isCrossSiteBrowserRequest,
  isLoopbackAddress,
  isLoopbackHostHeader,
  timingSafeStringEqual,
} from './loopback.util';

// 같은 머신에서만 부를 수 있는 경로용 가드 (부작용을 일으키는 write 표면).
// 1차 방어: loopback 판정. 2차(선택): CONSOLE_REMOTE_TOKEN 헤더.
//
// 원격에서 써야 하는 read 표면은 이 가드가 아니라 ConsoleReadGuard 를 쓴다 —
// 여기는 원격을 토큰으로도 열어 주지 않는다.
//
// (구 ConsoleWriteGuard. 콘솔 write 외에 크롤러 진입점도 같은 정책이 필요해져 common 으로 옮겼다.)
@Injectable()
export class LoopbackOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !isLoopbackAddress(request.ip) ||
      !isLoopbackHostHeader(request.header('host'))
    ) {
      throw new ForbiddenException('localhost 에서만 허용됩니다.');
    }
    // 출발지가 loopback 이어도 브라우저가 다른 사이트에서 쏜 것이면 사용자의 의도가 아니다.
    if (isCrossSiteBrowserRequest(request.header('sec-fetch-site'))) {
      throw new ForbiddenException('교차 출처 요청은 허용되지 않습니다.');
    }
    const expected = this.config.get<string>('CONSOLE_REMOTE_TOKEN');
    if (!expected) {
      return true;
    }
    const provided = request.header('x-console-token') ?? '';
    if (!timingSafeStringEqual(provided, expected)) {
      throw new UnauthorizedException('콘솔 토큰이 유효하지 않습니다.');
    }
    return true;
  }
}
