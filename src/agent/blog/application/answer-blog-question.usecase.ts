import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import {
  formatKstDate,
  getTodayKstDate,
} from '../../../common/util/kst-date.util';
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

// 상한은 넉넉히 두고, 그래도 상한까지 찼으면 "잘렸다" 를 facts 에 싣는다 — 잘린 목록을 전체처럼 넘기면
// 목록 밖의 글을 "없다" 고 답한다(#755 리뷰).
const DRAFT_LIMIT = 50;
const PUBLISHED_LOOKBACK_DAYS = 60;
const PUBLISHED_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1_000;

type Lookup<T> =
  | { kind: 'OK'; items: T[] }
  | { kind: 'FAILED'; reason: string };

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// facts 에 실을 모양 — 상한까지 찼으면 잘렸다고, 실패했으면 모른다고 밝힌다.
const describeLookup = <T>(lookup: Lookup<T>, limit: number) =>
  lookup.kind === 'FAILED'
    ? { status: '조회 실패로 모름', reason: lookup.reason }
    : { items: lookup.items, truncated: lookup.items.length >= limit };

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
        // 두 근거는 따로 조회한다 — 한쪽(예: Notion 토큰 만료)이 실패해도 남은 근거로 답할 수 있게.
        // 둘 다 실패하면 근거가 없으므로 실패로 끝낸다(#755 리뷰).
        const [drafts, published] = await Promise.all([
          this.queryDrafts(),
          this.queryPublished(now),
        ]);
        if (drafts.kind === 'FAILED' && published.kind === 'FAILED') {
          throw new Error(
            `블로그 근거 조회 실패 — 초안: ${drafts.reason} / 발행 기록: ${published.reason}`,
          );
        }
        const facts = {
          today: getTodayKstDate(),
          drafts: describeLookup(drafts, DRAFT_LIMIT),
          recentlyPublished: describeLookup(published, PUBLISHED_LIMIT),
          publishedRange: `최근 ${PUBLISHED_LOOKBACK_DAYS}일`,
          note: '발행 여부는 승인된 발행 카드 기록 기준이다. 목록에 없으면 최근 기간에 발행 승인된 기록이 없다는 뜻이고, 발행 후보 목록에 있었다는 것만으로 발행된 것은 아니다. 목록이 truncated 이거나 조회에 실패했으면 "목록에 없다" 로 단정하지 말고 확인하지 못했다고 말한다.',
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

  private async queryDrafts(): Promise<
    Lookup<{ title: string; createdAt: string }>
  > {
    const databaseId = this.config
      .get<string>('EVENING_RETRO_BLOG_NOTION_DATABASE_ID')
      ?.trim();
    // 초안 DB 설정이 없으면 "모름" — 빈 목록이라고 하면 "초안 없음" 으로 읽힌다.
    if (databaseId === undefined || databaseId.length === 0) {
      return { kind: 'FAILED', reason: '초안 DB 설정이 없음' };
    }
    try {
      const pages = await this.notionClient.queryDraftPages({
        databaseId,
        statusPropertyName:
          this.config.get<string>('BLOG_NOTION_PROP_STATUS')?.trim() ||
          DEFAULT_BLOG_PROP.status,
        statusValue:
          this.config.get<string>('BLOG_NOTION_STATUS_DRAFT_VALUE')?.trim() ||
          DEFAULT_BLOG_STATUS_DRAFT,
        limit: DRAFT_LIMIT,
      });
      return {
        kind: 'OK',
        items: pages.map((page) => ({
          title: page.title,
          createdAt: formatKstDate(page.createdTime) ?? page.createdTime,
        })),
      };
    } catch (error: unknown) {
      return { kind: 'FAILED', reason: toMessage(error) };
    }
  }

  private async queryPublished(
    now: number,
  ): Promise<Lookup<{ title: string; path: string; publishedAt: string }>> {
    try {
      const applied = await this.findRecentAppliedPreviews.execute({
        kind: PREVIEW_KIND.BLOG_GITHUB_PUBLISH,
        since: new Date(now - PUBLISHED_LOOKBACK_DAYS * DAY_MS),
        limit: PUBLISHED_LIMIT,
      });
      return {
        kind: 'OK',
        items: applied.flatMap((preview) =>
          isBlogGithubPublishPayload(preview.payload)
            ? [
                {
                  title: preview.payload.title,
                  path: preview.payload.path,
                  // 발행 경로가 Notion 에 KST 날짜로 기록하므로 같은 기준으로 맞춘다.
                  publishedAt:
                    formatKstDate(
                      (preview.appliedAt ?? preview.createdAt).toISOString(),
                    ) ?? '',
                },
              ]
            : [],
        ),
      };
    } catch (error: unknown) {
      return { kind: 'FAILED', reason: toMessage(error) };
    }
  }
}

const formatBlogFacts = (
  drafts: Lookup<{ title: string }>,
  published: Lookup<{ title: string; publishedAt: string }>,
): string =>
  [
    '*📝 블로그*',
    drafts.kind === 'FAILED'
      ? `• 초안 목록: 확인하지 못했어요 (${drafts.reason}).`
      : `• 남은 초안 ${drafts.items.length}건${drafts.items.length >= DRAFT_LIMIT ? ' 이상' : ''}${drafts.items.length > 0 ? `: ${drafts.items.map((draft) => draft.title).join(', ')}` : ''}`,
    published.kind === 'FAILED'
      ? '• 발행 기록: 확인하지 못했어요.'
      : published.items.length === 0
        ? `• 최근 ${PUBLISHED_LOOKBACK_DAYS}일 발행 기록 없음`
        : `• 최근 발행: ${published.items.map((post) => `${post.title}(${post.publishedAt})`).join(', ')}`,
  ].join('\n');
