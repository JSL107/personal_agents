import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import { PullRequestDetail } from '../../github/domain/github.type';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
  NotionPlanBlock,
} from '../../notion/domain/port/notion-client.port';
import { SlackService } from '../../slack/slack.service';
import {
  PR_CAREERLOG_QUEUE,
  PrCareerLogJobData,
} from '../../webhook/domain/webhook.type';
import { getTodayKstDate } from '../../common/util/kst-date.util';

// pull_request.closed (merged=true) webhook → 본인 PR 머지 시 Notion careerLog 자동 적재.
// LLM 호출 X — PR 메타 (title / body / additions / deletions / changedFiles) 를 그대로 변환.
// 멱등성은 BullMQ jobId dedup (`prcareerlog:<prRef>`) 으로 1차, Notion 페이지 append 가 추가 멱등성 X — 같은
// PR 이 re-deliver 되면 적재 2회 가능 (BullMQ removeOnComplete=50 안 이라면 dedup, 그 외엔 신중 운영 책임).
//
// 결과 통지: owner 에게 Slack DM 으로 한 줄 — "✅ PR #N careerLog 적재 (Notion)".
@Processor(PR_CAREERLOG_QUEUE, { concurrency: 1 })
export class WebhookPrCareerLogConsumer extends WorkerHost {
  private readonly logger = new Logger(WebhookPrCareerLogConsumer.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly slackService: SlackService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async process(job: Job<PrCareerLogJobData>): Promise<void> {
    const { prRef, slackUserId } = job.data;
    this.logger.log(`Webhook PR careerLog 시작 — ${prRef}`);

    const pageId = this.configService
      .get<string>('CAREER_LOG_NOTION_PAGE_ID')
      ?.trim();
    if (!pageId || pageId.length === 0) {
      this.logger.warn(
        `PR careerLog skip — CAREER_LOG_NOTION_PAGE_ID 미설정 (런타임 누락, controller 가드 후 변경 가능). prRef=${prRef}`,
      );
      return;
    }

    try {
      const detail = await this.fetchPullRequestDetail(prRef);
      const blocks = buildPrCareerLogBlocks({
        detail,
        prRef,
        todayKst: getTodayKstDate(),
      });
      await this.notionClient.appendBlocks({ pageId, blocks });
      this.logger.log(
        `PR careerLog 적재 완료 — pageId=${pageId} prRef=${prRef} blocks=${blocks.length}`,
      );
      await this.notifyOwner({ slackUserId, prRef, detail });
    } catch (error: unknown) {
      // 외부 시스템 (GitHub / Notion / Slack) 실패는 BullMQ attempts=2 로 재시도.
      this.logger.error(
        `PR careerLog 실패 (prRef=${prRef}): ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // prRef = 'owner/repo#number'. GithubClientPort.getPullRequest 가 PullRequestRef 를 받음.
  private async fetchPullRequestDetail(
    prRef: string,
  ): Promise<PullRequestDetail> {
    const match = prRef.match(/^([^/]+\/[^#]+)#(\d+)$/);
    if (!match) {
      throw new Error(`prRef 형식 오류: ${prRef} (기대: 'owner/repo#number')`);
    }
    const [, repo, numberStr] = match;
    return this.githubClient.getPullRequest({
      repo,
      number: Number(numberStr),
    });
  }

  private async notifyOwner({
    slackUserId,
    prRef,
    detail,
  }: {
    slackUserId: string;
    prRef: string;
    detail: PullRequestDetail;
  }): Promise<void> {
    const text = [
      `💼 *PR careerLog 자동 적재 완료*`,
      '',
      `• PR: <${detail.url}|${prRef}> — ${detail.title}`,
      `• 변경: +${detail.additions} / −${detail.deletions} (${detail.changedFilesTotalCount} files)`,
    ].join('\n');
    try {
      await this.slackService.postMessage({ target: slackUserId, text });
    } catch (error: unknown) {
      // 알람 자체 실패는 모듈 흐름 차단 X — append 는 이미 성공한 상태.
      this.logger.warn(
        `PR careerLog Slack 통지 실패 (prRef=${prRef}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// LLM 없이 PR 메타데이터를 careerLog block 으로 변환.
// 출력 구조 (Notion appendBlocks):
//   heading: 💼 PR #N — title (YYYY-MM-DD)
//   subheading: 정량
//   bullet: additions / deletions / files
//   subheading: 정성
//   bullet: title (PR 제목 그대로)
//   paragraph: body 첫 N 자 (있을 때)
//   divider
const PR_BODY_CAP = 600;

export const buildPrCareerLogBlocks = ({
  detail,
  prRef,
  todayKst,
}: {
  detail: PullRequestDetail;
  prRef: string;
  todayKst: string;
}): NotionPlanBlock[] => {
  const blocks: NotionPlanBlock[] = [
    {
      type: 'heading',
      text: `💼 ${prRef} — ${detail.title} (${todayKst})`,
    },
    { type: 'subheading', text: '정량' },
    {
      type: 'bullet',
      text: `+${detail.additions} / −${detail.deletions} (changed files: ${detail.changedFilesTotalCount})`,
    },
  ];
  if (detail.changedFiles.length > 0) {
    blocks.push({
      type: 'bullet',
      text: `대표 파일: ${detail.changedFiles.slice(0, 5).join(', ')}${detail.changedFilesTruncated ? ' …' : ''}`,
    });
  }
  blocks.push({ type: 'subheading', text: '정성' });
  blocks.push({ type: 'bullet', text: detail.title });
  const body = detail.body.trim();
  if (body.length > 0) {
    const capped = body.length > PR_BODY_CAP ? `${body.slice(0, PR_BODY_CAP)}…` : body;
    blocks.push({ type: 'paragraph', text: capped });
  }
  blocks.push({ type: 'paragraph', text: `링크: ${detail.url}` });
  blocks.push({ type: 'divider' });
  return blocks;
};
