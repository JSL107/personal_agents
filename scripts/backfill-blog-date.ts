// 결번 메우기 — 초안을 지목해 지난 날짜로 발행 승인 카드를 띄운다.
//
// 왜 별도 스크립트인가. 이 경로는 원래 Slack 슬래시(`/blog-publish --date=... --page=...`)로
// 들어가는데, 슬래시는 사람이 Slack 에서 쳐야 한다. 여기서는 같은 usecase 를 직접 태우고
// 카드만 Slack 으로 보낸다 — ✅ 를 누르는 마지막 관문은 그대로 사람 몫이다.
//
// AutopilotModule 을 태우지 않는 이유: 그 모듈을 부팅하면 실행 중인 서버의 BullMQ repeatable
// job 이 재등록되면서 저녁 회차가 지워질 수 있다. 그래서 카드 발송은 orchestrator 를 빌리지
// 않고 WebClient 로 직접 한다.
//
// 사용법:
//   pnpm exec ts-node scripts/backfill-blog-date.ts --page <pageId> --date <YYYY-MM-DD> [--dry]
//
// `--dry` 는 카드를 만들지 않고 발행본만 확인한다(모델은 실제로 태운다).
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WebClient } from '@slack/web-api';

import { PublishNotionDraftUsecase } from '../src/agent/blog/application/publish-notion-draft.usecase';
import { BlogModule } from '../src/agent/blog/blog.module';
import { parseBlogPublishArgs } from '../src/agent/blog/domain/blog-publish-args';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../src/preview-gate/domain/port/preview-action.repository.port';
import { PreviewGateModule } from '../src/preview-gate/preview-gate.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { buildPreviewBlocks } from '../src/slack/format/preview-message.builder';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    PreviewGateModule.forRoot({ appliers: [] }),
    BlogModule,
  ],
})
class BackfillBlogDateModule {}

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
};

const requireConfig = (config: ConfigService, key: string): string => {
  const value = config.get<string>(key);
  if (!value) {
    throw new Error(`${key} 가 .env 에 없습니다.`);
  }
  return value;
};

const main = async (): Promise<void> => {
  const pageId = readOption('page');
  const date = readOption('date');
  const dryRun = process.argv.includes('--dry');
  if (!pageId || !date) {
    throw new Error('--page <pageId> --date <YYYY-MM-DD> 가 모두 필요합니다.');
  }

  // 슬래시와 같은 파서를 태운다 — 날짜 검증 규칙이 두 경로에서 갈리지 않게.
  const args = parseBlogPublishArgs(`--page=${pageId} --date=${date}`);

  const application = await NestFactory.createApplicationContext(
    BackfillBlogDateModule,
    { logger: ['error', 'warn'] },
  );
  try {
    const config = application.get(ConfigService);
    const ownerSlackUserId = requireConfig(
      config,
      'AUTOPILOT_OWNER_SLACK_USER_ID',
    );
    const usecase = application.get(PublishNotionDraftUsecase);

    if (dryRun) {
      const { candidate } = await usecase.buildPublishCandidate({
        slackUserId: ownerSlackUserId,
        pageId: args.pageId as string,
        publishedAt: args.publishedAt as string,
      });
      console.log('status =', candidate.status);
      console.log(
        candidate.status === 'ready'
          ? `path = ${candidate.path}`
          : `message = ${candidate.message}`,
      );
      return;
    }

    const outcome = await usecase.execute({
      slackUserId: ownerSlackUserId,
      pageId: args.pageId as string,
      publishedAt: args.publishedAt as string,
    });
    const result = outcome.result;
    console.log('run =', outcome.agentRunId, '/ status =', result.status);
    if (result.status !== 'preview') {
      console.log('message =', result.message);
      return;
    }

    console.log('path =', result.path);
    const slack = new WebClient(requireConfig(config, 'SLACK_BOT_TOKEN'));
    const posted = await slack.chat.postMessage({
      channel: ownerSlackUserId,
      text: result.previewText,
      blocks: buildPreviewBlocks({
        previewText: result.previewText,
        previewId: result.previewId,
      }) as never,
    });

    // 전문은 스레드로. 카드 요약만 보고 ✅ 를 누르면 익명화 실패를 잡을 수 없다.
    if (posted.ts) {
      await slack.chat.postMessage({
        channel: ownerSlackUserId,
        thread_ts: posted.ts,
        text: `*발행될 파일* \`${result.path}\`\n\n${result.content}`,
      });
      // 좌표를 남겨야 승인·취소·만료 때 카드가 갱신돼 버튼이 사라진다.
      const previewRepository = application.get<PreviewActionRepositoryPort>(
        PREVIEW_ACTION_REPOSITORY_PORT,
      );
      await previewRepository.attachSlackMessage({
        id: result.previewId,
        slackChannelId: posted.channel as string,
        slackMessageTs: posted.ts,
      });
    }
    console.log('카드 발송 완료 — Slack DM 에서 ✅ 를 눌러주세요.');
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
