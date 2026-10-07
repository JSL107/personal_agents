#!/usr/bin/env node
'use strict';

/**
 * check-di — 앱 모듈 의존성 연결(DI) 게이트
 *
 * 단위 테스트는 클래스를 new 로 만들어 모듈 연결을 보지 못한다. #745 는 3중 green 과 CI 를 통과했지만
 * 앱 부팅이 UnknownDependenciesException 으로 죽었다(export 안 된 큐 토큰 주입, 핫픽스 #746).
 * 이 검사는 빌드 산출물(dist)의 AppModule 의존성 그래프를 preview 모드로 푼다.
 *
 * preview 모드는 provider 를 만들지 않는다(@nestjs/core injector.instantiateClass 가 new·factory 호출을
 * 건너뜀) — BullModule.forRootAsync·Prisma 등이 Redis/DB 에 연결하지 않는다. 단 ConfigModule.forRoot 의
 * validateEnv 는 import 시점에 돌므로 필수 env(REDIS_HOST·REDIS_PORT·DATABASE_URL)는 값이 있어야 한다.
 * CI 는 연결하지 않는 가짜 값을 넣는다(.github/workflows/ci.yml).
 *
 * 실행: `pnpm build && pnpm check:di` — 반드시 검사 대상 트리 안에서. 다른 worktree 의 node_modules 와
 * 섞이면 @nestjs/core 가 두 벌 로드돼 가짜 실패가 난다. 로컬은 `node --env-file=.env scripts/check-di.cjs`.
 */

const path = require('node:path');

async function main() {
  const { NestFactory } = require(path.join(process.cwd(), 'node_modules/@nestjs/core'));
  const { AppModule } = require(path.join(process.cwd(), 'dist/src/app.module'));
  await NestFactory.createApplicationContext(AppModule, {
    preview: true,
    abortOnError: false,
    logger: ['error'],
  });
}

main().then(
  () => {
    console.log('DI_OK');
    process.exit(0);
  },
  (error) => {
    console.error('DI_FAIL', String(error && error.message ? error.message : error));
    process.exit(1);
  },
);
