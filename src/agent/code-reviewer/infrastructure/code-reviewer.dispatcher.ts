import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  ResolvedLatestOpenPr,
  resolveLatestOpenPrRef,
} from '../../../github/application/resolve-latest-open-pr';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import {
  formatPullRequestPublication,
  formatPullRequestReview,
} from '../../../slack/format/pull-request-review.formatter';
import { ReviewPullRequestUsecase } from '../application/review-pull-request.usecase';
import { CodeReviewerException } from '../domain/code-reviewer.exception';
import { CodeReviewerErrorCode } from '../domain/code-reviewer-error-code.enum';
import { resolvePrReferenceFromConversation } from '../domain/conversation-pr-reference';

// 콘솔에서 PR 미지정 시 최근 open PR을 조회하는 범위.
const AUTO_RESOLVE_LOOKBACK_DAYS = 180;

// CODE_REVIEWER worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 를 prRef 로 매핑.
// 분류기는 PR 참조를 추출하지 않는다(출력에 그 칸이 없다). 원문에 참조가 없으면 직전 코드 리뷰
// 대화에서 이어받는다 — resolvePrReferenceFromConversation.
@Injectable()
export class CodeReviewerDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.CODE_REVIEWER;

  constructor(
    private readonly reviewPullRequest: ReviewPullRequestUsecase,
    private readonly config: ConfigService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    let prRef = input.text ?? '';
    let autoResolvedNotice: string | undefined;

    const fromConversation = resolvePrReferenceFromConversation(
      prRef,
      input.priorTurns,
    );
    if (fromConversation.kind === 'AMBIGUOUS') {
      throw new CodeReviewerException({
        code: CodeReviewerErrorCode.AMBIGUOUS_PR_REFERENCE,
        message: `직전 대화에 PR 이 여러 개(${fromConversation.candidates.join(', ')}) 있어서 어느 PR 인지 모르겠어요. 링크를 같이 보내 주세요.`,
        status: DomainStatus.BAD_REQUEST,
      });
    }
    if (fromConversation.kind === 'INHERITED') {
      prRef = fromConversation.prRef;
    }

    if (input.source === 'REMOTE_CONSOLE' && prRef.trim().length === 0) {
      const resolved = await this.resolveLatestOpenPrOrThrow();
      if (resolved) {
        prRef = resolved.prRef;
        autoResolvedNotice = resolved.notice;
      }
    }

    const outcome = await this.reviewWithNaturalLanguageError(input, {
      prRef,
      slackUserId: input.slackUserId,
      publish: input.publish ?? true,
      // 이 dispatcher 는 자연어 멘션과 콘솔 지시를 함께 받는다. 한 값으로 뭉뚱그리면
      // 트리거 타입을 나눈 목적(경로별 집계·감사)이 콘솔 실행에서 그대로 무너진다.
      triggerType:
        input.source === 'REMOTE_CONSOLE'
          ? TriggerType.REMOTE_CONSOLE_CODE_REVIEWER
          : TriggerType.SLACK_MENTION_CODE_REVIEWER,
      ...(input.conversationContext !== undefined
        ? { conversationContext: input.conversationContext }
        : {}),
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: [
        formatPullRequestReview({ prRef, review: outcome.result }),
        ...(outcome.publication !== undefined
          ? ['', formatPullRequestPublication(outcome.publication)]
          : []),
      ].join('\n'),
      ...(autoResolvedNotice !== undefined ? { autoResolvedNotice } : {}),
    };
  }

  // 참조 형식 오류의 기본 문구는 슬래시 명령 사용법이다. 자연어 대화에서 그 문구가 나가면
  // "명령어로 다시 하라" 는 안내가 된다(2026-08-27). Slack 자연어 경로만 대화 문구로 바꾸고,
  // 콘솔·슬래시 경로는 원래 예외를 그대로 둔다.
  private async reviewWithNaturalLanguageError(
    input: DispatchInput,
    request: Parameters<ReviewPullRequestUsecase['execute']>[0],
  ): ReturnType<ReviewPullRequestUsecase['execute']> {
    try {
      return await this.reviewPullRequest.execute(request);
    } catch (error: unknown) {
      if (
        input.source === 'SLACK_MESSAGE' &&
        error instanceof CodeReviewerException &&
        error.codeReviewerErrorCode ===
          CodeReviewerErrorCode.INVALID_PR_REFERENCE
      ) {
        throw new CodeReviewerException({
          code: CodeReviewerErrorCode.INVALID_PR_REFERENCE,
          message:
            '어느 PR 인지 찾지 못했어요. PR 링크(…/pull/123)나 owner/repo#123 을 같이 보내 주세요.',
          status: DomainStatus.BAD_REQUEST,
        });
      }
      throw error;
    }
  }

  private async resolveLatestOpenPrOrThrow(): Promise<ResolvedLatestOpenPr | null> {
    const author = this.config.get<string>('IMPACT_REPORT_GITHUB_AUTHOR');
    if (!author) {
      return null;
    }

    const repoEnv = this.config.get<string>('IMPACT_REPORT_GITHUB_REPO');
    const repo = repoEnv && repoEnv.trim().length > 0 ? repoEnv : null;
    const sinceIsoDate = new Date(
      Date.now() - AUTO_RESOLVE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const resolved = await resolveLatestOpenPrRef(this.githubClient, {
      author,
      repo,
      sinceIsoDate,
    });
    if (!resolved) {
      throw new CodeReviewerException({
        code: CodeReviewerErrorCode.NO_OPEN_PR_FOUND,
        message: `리뷰할 PR 을 지정하지 않았고, 최근 ${AUTO_RESOLVE_LOOKBACK_DAYS}일 안에 열려있는 PR 도 없습니다. PR 링크(owner/repo#N)를 함께 지시해주세요.`,
        status: DomainStatus.NOT_FOUND,
      });
    }

    return resolved;
  }
}
