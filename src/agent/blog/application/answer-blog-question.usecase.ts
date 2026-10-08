import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import {
  FactAnswer,
  FactAnswerUsecase,
} from '../../../fact-answer/application/fact-answer.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../../../notion/domain/port/notion-client.port';
import { FindRecentAppliedPreviewsUsecase } from '../../../preview-gate/application/find-recent-applied-previews.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { ConversationTurn } from '../../../router/domain/conversation-memory.type';
import { isBlogGithubPublishPayload } from '../domain/blog.type';
import {
  DEFAULT_BLOG_PROP,
  DEFAULT_BLOG_STATUS_DRAFT,
} from '../domain/blog-publish-properties';

interface AnswerBlogQuestionCommand {
  slackUserId: string;
  text: string;
  priorTurns: readonly ConversationTurn[];
  parsedIntent: Record<string, unknown>;
}

const DRAFT_LIMIT = 20;
const PUBLISHED_LOOKBACK_DAYS = 60;
const PUBLISHED_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1_000;

// "그 글 발행된 거야?", "남은 초안 뭐 있어?" 같은 질문에 Notion 초안 목록과 최근 발행 이력으로 답한다.
// 예전에는 이런 질문이 발행 절차(익명화 LLM·승인 카드)를 시작하거나, 대화 답변이 확인 없이
// "아직 발행된 건 아니에요" 라고 단정했다(eval h-study-published-0908 관찰).
// (plan: docs/superpowers/plans/2026-10-07-nl-answer-fidelity.md 후속)
@Injectable()
export class AnswerBlogQuestionUsecase {
  constructor(
    private readonly config: ConfigService,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly findRecentAppliedPreviews: FindRecentAppliedPreviewsUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly factAnswer: FactAnswerUsecase,
  ) {}

  async execute({
    slackUserId,
    text,
    priorTurns,
    parsedIntent,
  }: AnswerBlogQuestionCommand): Promise<AgentRunOutcome<FactAnswer>> {
    return this.agentRunService.execute({
      agentType: AgentType.BLOG_PUBLISH,
      triggerType: TriggerType.SLACK_MENTION_BLOG_PUBLISH,
      inputSnapshot: { slackUserId, action: 'UNKNOWN', parsedIntent },
      evidence: [],
      run: async () => {
        const now = Date.now();
        const databaseId = this.config
          .get<string>('EVENING_RETRO_BLOG_NOTION_DATABASE_ID')
          ?.trim();
        // 초안 DB 설정이 없으면 초안은 "모름" 으로 둔다 — 빈 목록이라고 하면 "초안 없음" 으로 읽힌다.
        const drafts =
          databaseId === undefined || databaseId.length === 0
            ? null
            : await this.notionClient.queryDraftPages({
                databaseId,
                statusPropertyName:
                  this.config.get<string>('BLOG_NOTION_PROP_STATUS')?.trim() ||
                  DEFAULT_BLOG_PROP.status,
                statusValue:
                  this.config
                    .get<string>('BLOG_NOTION_STATUS_DRAFT_VALUE')
                    ?.trim() || DEFAULT_BLOG_STATUS_DRAFT,
                limit: DRAFT_LIMIT,
              });
        const applied = await this.findRecentAppliedPreviews.execute({
          kind: PREVIEW_KIND.BLOG_GITHUB_PUBLISH,
          since: new Date(now - PUBLISHED_LOOKBACK_DAYS * DAY_MS),
          limit: PUBLISHED_LIMIT,
        });
        const published = applied.flatMap((preview) =>
          isBlogGithubPublishPayload(preview.payload)
            ? [
                {
                  title: preview.payload.title,
                  path: preview.payload.path,
                  publishedAt: (preview.appliedAt ?? preview.createdAt)
                    .toISOString()
                    .slice(0, 10),
                },
              ]
            : [],
        );
        const facts = {
          today: new Date(now).toISOString().slice(0, 10),
          drafts:
            drafts === null
              ? '초안 DB 설정이 없어 초안 목록을 모름'
              : drafts.map((draft) => ({
                  title: draft.title,
                  createdAt: draft.createdTime.slice(0, 10),
                })),
          recentlyPublished: published,
          publishedRange: `최근 ${PUBLISHED_LOOKBACK_DAYS}일`,
          note: '발행 여부는 승인된 발행 카드 기록 기준이다. 목록에 없으면 최근 기간에 발행 승인된 기록이 없다는 뜻이고, 발행 후보 목록에 있었다는 것만으로 발행된 것은 아니다.',
        };
        const answer = await this.factAnswer.answer({
          agentType: AgentType.BLOG_PUBLISH,
          text,
          priorTurns,
          facts,
          fallbackText: formatBlogFacts(drafts, published),
        });
        return {
          result: answer,
          modelUsed: answer.modelUsed,
          output: {
            facts,
            reply: answer.text,
            usedFallback: answer.usedFallback,
            ...(answer.numberCheck !== undefined
              ? { numberCheck: answer.numberCheck }
              : {}),
            ...(answer.answerError !== undefined
              ? { answerError: answer.answerError }
              : {}),
          },
        };
      },
    });
  }
}

const formatBlogFacts = (
  drafts: { title: string }[] | null,
  published: { title: string; publishedAt: string }[],
): string =>
  [
    '*📝 블로그*',
    drafts === null
      ? '• 초안 목록: 설정이 없어 확인할 수 없어요.'
      : `• 남은 초안 ${drafts.length}건${drafts.length > 0 ? `: ${drafts.map((draft) => draft.title).join(', ')}` : ''}`,
    published.length === 0
      ? `• 최근 ${PUBLISHED_LOOKBACK_DAYS}일 발행 기록 없음`
      : `• 최근 발행: ${published.map((post) => `${post.title}(${post.publishedAt})`).join(', ')}`,
  ].join('\n');
