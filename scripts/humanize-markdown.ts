// 마크다운 파일 하나를 블로그 목소리로 윤문해 보는 스크립트 — 문체 규칙을 손볼 때 쓴다.
//
// 왜 verify-blog-publish.ts 로 안 되는가 — 그쪽은 Notion 초안을 읽어 익명화·편집까지 함께
// 돌린다. 문체 규칙만 바꿔 놓고 결과를 보려면 같은 입력을 반복해 넣어야 하는데, 초안 상태가
// 그때그때 달라 대조가 안 된다. 여기서는 파일이 입력이라 before/after 를 같은 글로 잰다.
//
// 사용법:
//   pnpm exec ts-node scripts/humanize-markdown.ts <입력.md> [--out <출력.md>]
import { readFileSync, writeFileSync } from 'node:fs';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { HumanizeService } from '../src/humanize/application/humanize.service';
import { humanizeMarkdownProse } from '../src/humanize/application/humanize-markdown.adapter';
import {
  formatKoreanStyleMetrics,
  measureKoreanStyle,
} from '../src/humanize/domain/korean-style-metrics';
import { HumanizeModule } from '../src/humanize/humanize.module';
import { PrismaModule } from '../src/prisma/prisma.module';

@Module({
  // HumanizeModule 이 딸린 세 모듈에는 cron·queue 가 없다. AppModule 을 통째로 띄우면
  // 돌고 있는 서비스의 repeatable job 이 재등록되므로 필요한 것만 올린다.
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HumanizeModule,
  ],
})
class HumanizeMarkdownModule {}

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
};

const main = async (): Promise<void> => {
  const inputPath = process.argv[2];
  if (!inputPath || inputPath.startsWith('--')) {
    throw new Error('입력 마크다운 경로가 필요하다');
  }
  const source = readFileSync(inputPath, 'utf8');

  const application = await NestFactory.createApplicationContext(
    HumanizeMarkdownModule,
    { logger: ['error', 'warn'] },
  );
  try {
    const humanizer = application.get(HumanizeService);
    if (!humanizer.isEnabled()) {
      throw new Error('HUMANIZE_REPORTS_ENABLED=false — 윤문이 꺼져 있다');
    }
    const started = Date.now();
    const result = await humanizeMarkdownProse(source, humanizer);
    const elapsedSeconds = Math.round((Date.now() - started) / 1000);

    // 윤문이 통째로 실패해도 어댑터는 원문을 그대로 돌려준다(best-effort). 0문단이면
    // "규칙이 안 먹었다" 가 아니라 "모델 호출이 실패했다" 이므로 구분해서 알린다.
    // exit code 로도 알린다 — 사람이 로그를 훑는 스크립트여도, 실패를 0 으로 흘리면
    // 반복 실행을 스크립트로 감쌀 때 실패한 회차가 조용히 표본에 섞인다.
    if (result.changedParagraphs === 0) {
      console.error(
        `[실패] 바뀐 문단 0/${result.proseParagraphs} — 모델 호출이 실패했거나 응답이 비었다`,
      );
      process.exitCode = 1;
    }
    console.log(
      `윤문: ${result.changedParagraphs}/${result.proseParagraphs}문단 · ${elapsedSeconds}초`,
    );
    console.log(
      '[before] ' + formatKoreanStyleMetrics(measureKoreanStyle(source)),
    );
    console.log(
      '[after ] ' +
        formatKoreanStyleMetrics(measureKoreanStyle(result.markdown)),
    );

    const outPath = readOption('out');
    if (outPath) {
      writeFileSync(outPath, result.markdown, 'utf8');
      console.log(`출력: ${outPath}`);
    }
  } finally {
    await application.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
