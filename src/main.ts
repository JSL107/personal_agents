import { join } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import * as express from 'express';

import { interruptRunsOnSignal } from './agent-run/interface/interrupt-runs-on-signal';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filter/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptor/response.interceptor';
import {
  RotatingFileLog,
  teeStreamsToFile,
} from './common/logging/rotating-file-log';

// 서버 로그 파일 — logs/ 는 gitignore. 10MB × 5개(현재 포함)를 넘으면 가장 오래된 것부터 지운다.
// 앱은 레포 루트를 cwd 로 뜬다(scripts/console-dev.sh 가 cd "$ROOT").
const SERVER_LOG_PATH = join(process.cwd(), 'logs', 'server.log');
const SERVER_LOG_MAX_BYTES = 10 * 1024 * 1024;
const SERVER_LOG_MAX_FILES = 5;

async function bootstrap() {
  // 부팅 로그부터 남기려고 앱 생성보다 먼저 건다. 파일을 못 열어도 부팅은 막지 않는다.
  try {
    teeStreamsToFile(
      new RotatingFileLog(
        SERVER_LOG_PATH,
        SERVER_LOG_MAX_BYTES,
        SERVER_LOG_MAX_FILES,
      ),
      [process.stdout, process.stderr],
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[file-log] 파일 로그를 열지 못함 — 화면 출력만: ${message}\n`,
    );
  }
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // 신호로 죽을 때 실행 중이던 run 에 중단 사유를 남긴다 — 없으면 원장에 IN_PROGRESS 로 남아
  // 30분 뒤 원인 불명 스윕으로 닫힌다. 종료 시간은 마감 기록 한 번만큼만 늘어난다.
  interruptRunsOnSignal(app);

  // OPS-2: 두 webhook 엔드포인트 모두 raw body 로 받아 HMAC 검증 + JSON.parse 흐름 유지.
  // express 가 application/json 을 자동 파싱하면 rawBody 가 object 가 되어 HMAC 실패함 (codex P1).
  app.use('/v1/agent/trigger', express.text({ type: '*/*', limit: '1mb' }));
  app.use('/v1/agent/github', express.text({ type: '*/*', limit: '1mb' }));
  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  // Reflector 주입 — @RawResponse(SSE) 핸들러는 ResponseInterceptor 래핑을 건너뛴다.
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));

  const port = configService.get<number>('PORT') ?? 3000;
  await app.listen(port);
}
bootstrap();
