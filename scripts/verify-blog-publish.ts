// 일회성 검증 스크립트 — BLOG_PUBLISH 익명화 파싱이 실제 모델 응답으로 통과하는지만 확인한다.
// buildPublishCandidate 는 Notion 읽기 + 모델 호출 + 파싱 + 금지어 검사까지만 하고,
// preview 카드 생성·GitHub 커밋은 execute() 쪽이라 여기서는 외부 부작용이 없다.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { PublishNotionDraftUsecase } from '../src/agent/blog/application/publish-notion-draft.usecase';
import { BlogModule } from '../src/agent/blog/blog.module';
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

const main = async (): Promise<void> => {
  const application = await NestFactory.createApplicationContext(
    VerifyBlogPublishModule,
    { logger: ['error', 'warn'] },
  );
  try {
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
