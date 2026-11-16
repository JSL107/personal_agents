import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { RunParamTuneUsecase } from '../src/param-tune/application/run-param-tune.usecase';
import {
  ParamTuneCliOptions,
  parseParamTuneCliArguments,
} from '../src/param-tune/interface/param-tune-cli.parser';
import { ParamTuneModule } from '../src/param-tune/param-tune.module';

/**
 * 주간 자동 튜닝의 자식 프로세스 진입점 — 앱이 `ParamTuneChildLauncher` 로 띄운다.
 * 무거운 재생을 앱 이벤트 루프 밖에서 돌리고, 타임아웃이면 프로세스째 죽일 수 있게 하려는 분리다.
 * 실패는 `RunParamTuneUsecase` 가 원장에 기록하므로 여기서는 인자 오류만 exit 2 로 낸다.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ParamTuneModule],
})
class ParamTuneCliModule {}

const main = async (): Promise<void> => {
  let options: ParamTuneCliOptions;
  try {
    options = parseParamTuneCliArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  const application = await NestFactory.createApplicationContext(
    ParamTuneCliModule,
    { logger: ['warn', 'error'] },
  );
  try {
    await application.get(RunParamTuneUsecase).execute(options);
  } finally {
    await application.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
