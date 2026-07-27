import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { RAW_RESPONSE_KEY } from '../decorator/raw-response.decorator';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  const buildContext = (): ExecutionContext =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class {},
    }) as unknown as ExecutionContext;

  const buildNext = (value: unknown): CallHandler => ({
    handle: () => of(value),
  });

  it('일반 핸들러 결과는 {code,message,data} 로 감싼다', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const interceptor = new ResponseInterceptor(reflector);

    const result = await firstValueFrom(
      interceptor.intercept(buildContext(), buildNext({ x: 1 })),
    );

    expect(result).toEqual({
      code: 'SUCCESS',
      message: expect.any(String),
      data: { x: 1 },
    });
  });

  it('@RawResponse 핸들러는 감싸지 않고 원본을 그대로 흘린다 (SSE 보호)', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const interceptor = new ResponseInterceptor(reflector);
    const raw = { data: { type: 'state.changed' } };

    const result = await firstValueFrom(
      interceptor.intercept(buildContext(), buildNext(raw)),
    );

    expect(result).toBe(raw);
  });

  it('reflector 미주입이어도 일반 래핑은 동작한다 (하위호환)', async () => {
    const interceptor = new ResponseInterceptor();

    const result = await firstValueFrom(
      interceptor.intercept(buildContext(), buildNext('ok')),
    );

    expect(result).toEqual({
      code: 'SUCCESS',
      message: expect.any(String),
      data: 'ok',
    });
  });

  it('RAW_RESPONSE_KEY 로 핸들러/클래스 메타데이터를 조회한다', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue(false);
    const reflector = { getAllAndOverride } as unknown as Reflector;
    const interceptor = new ResponseInterceptor(reflector);

    await firstValueFrom(
      interceptor.intercept(buildContext(), buildNext(null)),
    );

    expect(getAllAndOverride).toHaveBeenCalledWith(RAW_RESPONSE_KEY, [
      expect.any(Function),
      expect.any(Function),
    ]);
  });
});
