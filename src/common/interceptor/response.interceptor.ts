import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';

import { RAW_RESPONSE_KEY } from '../decorator/raw-response.decorator';
import { ResponseCode } from '../exception/response-code.enum';
import { ApiResponse } from '../response/api-response.type';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T> | T
> {
  // Reflector 는 옵셔널 — main.ts 는 주입하고, 기존 단위/e2e 의 `new ResponseInterceptor()` 는
  // 미주입(undefined)이라 기존 래핑 동작을 그대로 유지한다.
  constructor(private readonly reflector?: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | T> {
    const isRaw =
      this.reflector?.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    // @RawResponse 핸들러(SSE 등)는 본문을 가공하지 않고 그대로 흘려보낸다.
    if (isRaw) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        code: ResponseCode.SUCCESS,
        message: '요청이 성공적으로 처리되었습니다.',
        data: data ?? null,
      })),
    );
  }
}
