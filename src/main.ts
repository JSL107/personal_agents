import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filter/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptor/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use('/v1/agent/trigger', express.text({ type: '*/*', limit: '1mb' }));
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
