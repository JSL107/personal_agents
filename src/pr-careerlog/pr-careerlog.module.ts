import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { GithubModule } from '../github/github.module';
import { NotionModule } from '../notion/notion.module';
import { SlackModule } from '../slack/slack.module';
import { PR_CAREERLOG_QUEUE } from '../webhook/domain/webhook.type';
import { WebhookPrCareerLogConsumer } from './infrastructure/pr-careerlog.consumer';

// pull_request.closed (merged=true) webhook → 본인 PR 머지 시 Notion careerLog 자동 적재.
// LLM 없는 경로 — GitHub PR detail → 직접 block 변환 → Notion appendBlocks → Slack DM 통지.
// env 미설정 (PR_CAREERLOG_AUTO_ENABLED / CAREER_LOG_NOTION_PAGE_ID / GITHUB_WEBHOOK_OWNER_LOGIN)
// 시 webhook controller 가드에서 enqueue 단계 자체를 skip — consumer 본체는 항상 등록.
@Module({
  imports: [
    BullModule.registerQueue({ name: PR_CAREERLOG_QUEUE }),
    GithubModule,
    NotionModule,
    SlackModule,
  ],
  providers: [WebhookPrCareerLogConsumer],
})
export class PrCareerLogModule {}
