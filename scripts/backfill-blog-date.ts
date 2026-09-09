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
import { TriggerType } from '../src/agent-run/domain/agent-run.type';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../src/notion/domain/port/notion-client.port';
import { CancelPreviewUsecase } from '../src/preview-gate/application/cancel-preview.usecase';
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
      // 편집 단계가 "발행할 만하지 않다" 로 판정하면 usecase 는 holdDraft 로 Notion 초안을
      // 보류 상태로 옮긴다(`publish-notion-draft.usecase.ts:500`). 발행본만 확인하려던
      // 실행이 프로덕션 초안 상태를 바꾸면 안 되므로 쓰기만 가로막는다 —
      // `verify-blog-publish.ts` 와 같은 방식이고, 나머지 단계는 실제 모델을 그대로 호출한다.
      const notionClient =
        application.get<NotionClientPort>(NOTION_CLIENT_PORT);
      notionClient.updatePageProperties = async (input): Promise<void> => {
        console.log(
          '[dry-run] Notion 속성 갱신 생략 =',
          JSON.stringify(input.properties),
        );
      };
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
      // 생략하면 기본값 SLACK_COMMAND_BLOG_PUBLISH 로 적재돼, 스크립트로 메운 회차가
      // Slack 명령 실행으로 집계된다.
      triggerType: TriggerType.MANUAL,
    });
    const result = outcome.result;
    console.log('run =', outcome.agentRunId, '/ status =', result.status);
    if (result.status !== 'preview') {
      console.log('message =', result.message);
      return;
    }

    console.log('path =', result.path);
    const slack = new WebClient(requireConfig(config, 'SLACK_BOT_TOKEN'));
    // execute 는 이미 PENDING preview 를 저장했다. 카드·좌표·전문 중 하나라도 못 나가면
    // 승인 버튼만 살아 있는 카드가 남아, 전문을 못 본 채 ✅ 를 누르면 익명화 실패가
    // 공개 저장소로 나간다. #528 이 autopilot 경로에 세운 판단을, 그 게이트를 지나지 않는
    // 이 경로에도 둔다 — 실패하면 preview 를 취소해 카드를 CANCELLED 로 닫는다.
    try {
      const posted = await slack.chat.postMessage({
        channel: ownerSlackUserId,
        text: result.previewText,
        blocks: buildPreviewBlocks({
          previewText: result.previewText,
          previewId: result.previewId,
        }) as never,
      });
      if (!posted.ts) {
        throw new Error('Slack 이 카드 ts 를 돌려주지 않았습니다.');
      }

      // 좌표를 전문보다 먼저 남긴다. 순서가 반대면 전문 발송이 실패했을 때 취소가
      // 카드를 찾지 못해 버튼이 그대로 남는다.
      const previewRepository = application.get<PreviewActionRepositoryPort>(
        PREVIEW_ACTION_REPOSITORY_PORT,
      );
      await previewRepository.attachSlackMessage({
        id: result.previewId,
        slackChannelId: posted.channel as string,
        slackMessageTs: posted.ts,
      });

      // 전문은 스레드로. 카드 요약만 보고 ✅ 를 누르면 익명화 실패를 잡을 수 없다.
      await slack.chat.postMessage({
        channel: ownerSlackUserId,
        thread_ts: posted.ts,
        text: `*발행될 파일* \`${result.path}\`\n\n${result.content}`,
      });
    } catch (error: unknown) {
      // 취소가 또 실패해도 원인 예외는 삼키지 않는다.
      await application
        .get(CancelPreviewUsecase)
        .execute({
          previewId: result.previewId,
          slackUserId: ownerSlackUserId,
        })
        .catch((cancelError: unknown) => {
          console.error(
            'preview 취소도 실패 — 손으로 정리해야 합니다:',
            result.previewId,
            cancelError,
          );
        });
      throw error;
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
