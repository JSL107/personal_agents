import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

// 콘솔 리모컨 write 게이트. read 경로(ConsoleController/SSE)는 대상 아님.
// 1차 방어: loopback 바인딩(같은 머신만). 2차(선택): CONSOLE_REMOTE_TOKEN 헤더.
@Injectable()
export class ConsoleWriteGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!this.isLoopback(request.ip)) {
      throw new ForbiddenException(
        '콘솔 write 는 localhost 에서만 허용됩니다.',
      );
    }
    const expected = this.config.get<string>('CONSOLE_REMOTE_TOKEN');
    if (!expected) {
      return true;
    }
    const provided = request.header('x-console-token') ?? '';
    if (!this.safeEqual(provided, expected)) {
      throw new UnauthorizedException('콘솔 토큰이 유효하지 않습니다.');
    }
    return true;
  }

  private isLoopback(ip: string | undefined): boolean {
    if (!ip) {
      return false;
    }
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }

  private safeEqual(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    if (bufferA.length !== bufferB.length) {
      return false;
    }
    return timingSafeEqual(bufferA, bufferB);
  }
}
