// 발행 라인 검증 스크립트 — 익명화·편집·윤문을 실제 모델로 돌려 발행본을 만들어 본다.
// buildPublishCandidate 는 Notion 읽기 + 모델 호출 + 파싱 + 금지어 검사까지만 하고,
// preview 카드 생성·GitHub 커밋은 execute() 쪽이라 여기서는 외부 부작용이 없다.
//
// 사용법:
//   pnpm exec ts-node scripts/verify-blog-publish.ts [--dump <파일경로>]
//
// --dump 를 주면 발행본 전문을 그 경로에 쓴다. 앞 500자만 봐서는 고유명사 보존·코드블록·
// 분류처럼 본문 전체에 흩어진 것을 확인할 수 없어, 매번 스크립트를 손대는 대신 옵션으로 둔다.
import { writeFileSync } from 'node:fs';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { PublishNotionDraftUsecase } from '../src/agent/blog/application/publish-notion-draft.usecase';
import { BlogModule } from '../src/agent/blog/blog.module';
import {
  formatKoreanStyleMetrics,
  measureKoreanStyle,
} from '../src/humanize/domain/korean-style-metrics';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../src/notion/domain/port/notion-client.port';
import { PreviewGateModule } from '../src/preview-gate/preview-gate.module';
import { PrismaModule } from '../src/prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    // forRoot 만 global: true 라 BlogModule 이 CreatePreviewUsecase 를 주입받을 수 있다.
    PreviewGateModule.forRoot({ appliers: [] }),
    BlogModule,
  ],
})
class VerifyBlogPublishModule {}

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
};

const main = async (): Promise<void> => {
  const dumpPath = readOption('dump');
  const application = await NestFactory.createApplicationContext(
    VerifyBlogPublishModule,
    { logger: ['error', 'warn'] },
  );
  try {
    // Notion 쓰기만 가로막는다 — 검증 때문에 실제 초안 상태가 바뀌면 안 된다.
    // 나머지 세 단계(익명화·편집·윤문)는 실제 모델을 그대로 호출한다.
    const notionClient = application.get<NotionClientPort>(NOTION_CLIENT_PORT);
    notionClient.updatePageProperties = async (input): Promise<void> => {
      console.log(
        '[dry-run] Notion 속성 갱신 생략 =',
        JSON.stringify(input.properties),
      );
    };

    const usecase = application.get(PublishNotionDraftUsecase);
    console.log('isPublishConfigured =', usecase.isPublishConfigured());

    const { candidate, modelUsed } = await usecase.buildPublishCandidate({
      slackUserId: process.env.OWNER_SLACK_USER_ID ?? 'U091CF9REP6',
    });

    console.log('modelUsed =', modelUsed);
    console.log('status =', candidate.status);
    if (candidate.status === 'ready') {
      console.log('path =', candidate.path);
      console.log('본문 코드펜스 포함 =', candidate.content.includes('```'));
      console.log('본문 길이 =', candidate.content.length);
      console.log(
        formatKoreanStyleMetrics(measureKoreanStyle(candidate.content)),
      );
      console.log('--- 카드 previewText ---');
      console.log(candidate.previewText);
      if (dumpPath) {
        writeFileSync(dumpPath, candidate.content, 'utf8');
        console.log('전문 저장 =', dumpPath);
      }
      console.log('--- content 앞 500자 ---');
      console.log(candidate.content.slice(0, 500));
    } else {
      console.log('message =', candidate.message);
    }
  } finally {
    await application.close();
  }
};

void main().catch((error: unknown) => {
  const asError = error as { message?: string; cause?: { message?: string } };
  console.error('FAILED:', asError.message);
  console.error('CAUSE :', asError.cause?.message);
  process.exit(1);
});
