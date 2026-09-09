import { writeFileSync } from 'node:fs';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { ReviewPullRequestUsecase } from '../src/agent/code-reviewer/application/review-pull-request.usecase';
import { CodeReviewerModule } from '../src/agent/code-reviewer/code-reviewer.module';
import { PrismaModule } from '../src/prisma/prisma.module';

/**
 * 게시 없이 PR 리뷰만 돌려 결과를 본다. 프롬프트·컨텍스트를 바꾼 뒤 과거 PR 로 회귀를
 * 재는 용도다.
 *
 * `AppModule` 을 태우지 않는 이유: 전체 부팅은 실행 중인 서버의 BullMQ repeatable job 을
 * 재등록하면서 예약된 회차를 지운다. 리뷰에 필요한 모듈만 올린다.
 *
 * 사용법:
 *   pnpm review:dry JSL107/personal_agents#412
 *   pnpm review:dry JSL107/personal_agents#412 --out /tmp/412.json
 *
 * 게시·카드 생성은 하지 않는다(`dryRun: true`). 모델은 실제로 태우므로 쿼터를 쓴다.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CodeReviewerModule,
  ],
})
class ReviewPrDryModule {}

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
};

const main = async (): Promise<void> => {
  const prRef = process.argv[2];
  if (prRef === undefined || prRef.startsWith('--')) {
    throw new Error(
      'PR 참조가 없습니다. 사용법: pnpm review:dry <owner/repo#N> [--out <path>]',
    );
  }

  const application = await NestFactory.createApplicationContext(
    ReviewPrDryModule,
    { logger: ['error', 'warn'] },
  );
  try {
    const usecase = application.get(ReviewPullRequestUsecase);
    const startedAt = Date.now();
    const outcome = await usecase.execute({
      prRef,
      slackUserId: 'cli-dry-run',
      publish: true,
      // 게시 경로를 타되 연습 모드로 — 정책 계산(정렬·상한)까지 그대로 확인하면서
      // GitHub 코멘트와 카드는 만들지 않는다.
      dryRun: true,
    });
    const elapsedMs = Date.now() - startedAt;

    const report = {
      prRef,
      elapsedMs,
      modelUsed: outcome.modelUsed,
      agentRunId: outcome.agentRunId,
      review: outcome.result,
    };
    const serialized = JSON.stringify(report, null, 2);
    process.stdout.write(`${serialized}\n`);

    const outPath = readOption('out');
    if (outPath !== undefined) {
      writeFileSync(outPath, serialized, 'utf8');
      process.stderr.write(`저장: ${outPath}\n`);
    }
  } finally {
    await application.close();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
