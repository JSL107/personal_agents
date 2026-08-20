import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AgentRunModule } from '../src/agent-run/agent-run.module';
import { TriggerType } from '../src/agent-run/domain/agent-run.type';
import { PrismaModule } from '../src/prisma/prisma.module';
import { ExpandStudyBriefUsecase } from '../src/study-brief-cron/application/expand-study-brief.usecase';
import { StudyDeepdiveModule } from '../src/study-brief-cron/study-deepdive.module';

// 사용법:
//   pnpm exec ts-node scripts/study-deepdive.ts --owner <SLACK_USER_ID>
//
// autopilot task 가 매일 11:00 에 하는 것과 **같은 usecase** 를 부른다. cron 을 기다리지 않고
// 확장 경로를 실증하기 위한 입구다 — 트리거가 자동뿐이면 검증이 다음 발화까지 묶인다.
// triggerType 은 MANUAL 로 남겨 원장에서 자동 회차(AUTOPILOT_STUDY_DEEPDIVE_CRON)와 구분한다.
//
// ⚠️ AppModule 전체를 부팅하지 않는다. 전체 부팅은 실행 중인 서버의 BullMQ repeatable job 을
//    재등록해 남의 cron 을 지운다. 필요한 모듈만 올린다.
const USAGE =
  '사용법:\n  pnpm exec ts-node scripts/study-deepdive.ts --owner <SLACK_USER_ID>';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AgentRunModule,
    StudyDeepdiveModule,
  ],
})
class StudyDeepdiveCliModule {}

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
};

const main = async (): Promise<void> => {
  const owner =
    readOption('owner') ?? process.env.AUTOPILOT_OWNER_SLACK_USER_ID;
  if (!owner) {
    throw new Error(
      `owner 를 알 수 없습니다. --owner 로 넘기거나 AUTOPILOT_OWNER_SLACK_USER_ID 를 설정하세요.\n${USAGE}`,
    );
  }

  const app = await NestFactory.createApplicationContext(
    StudyDeepdiveCliModule,
    { logger: ['error', 'warn', 'log'] },
  );
  try {
    const usecase = app.get(ExpandStudyBriefUsecase);
    if (!usecase.isConfigured()) {
      throw new Error(
        'EVENING_RETRO_BLOG_NOTION_DATABASE_ID 가 없어 초안을 적재할 곳이 없습니다 (.env 확인).',
      );
    }
    const outcome = await usecase.execute({
      ownerSlackUserId: owner,
      triggerType: TriggerType.MANUAL,
    });
    const result = outcome.result;
    if (result.status === 'empty') {
      console.log(
        `확장할 오늘의 공부가 없습니다 (run #${outcome.agentRunId}).`,
      );
      return;
    }
    console.log(
      [
        `오늘의 공부 '${result.topic}' → 블로그 초안 (run #${outcome.agentRunId})`,
        `  제목   ${result.title}`,
        `  분량   ${result.bodyLength.toLocaleString('ko-KR')}자`,
        `  태그   ${result.tags.join(', ') || '(없음)'}`,
        `  Notion ${result.notionUrl}`,
        '',
        '발행은 저녁 블로그 카드(19:00)가 승인을 받아서 한다. 지금 확인하려면 Slack 에서',
        '/blog-publish 를 실행하면 이 초안이 먼저 후보로 잡힌다(출처유형=오늘의 공부).',
      ].join('\n'),
    );
  } finally {
    await app.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
