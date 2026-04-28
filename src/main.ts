import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filter/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptor/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // OPS-2: 두 webhook 엔드포인트 모두 raw body 로 받아 HMAC 검증 + JSON.parse 흐름 유지.
  // express 가 application/json 을 자동 파싱하면 rawBody 가 object 가 되어 HMAC 실패함 (codex P1).
  app.use('/v1/agent/trigger', express.text({ type: '*/*', limit: '1mb' }));
  app.use('/v1/agent/github', express.text({ type: '*/*', limit: '1mb' }));
  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const port = configService.get<number>('PORT') ?? 3000;
  await app.listen(port);
}
bootstrap();
