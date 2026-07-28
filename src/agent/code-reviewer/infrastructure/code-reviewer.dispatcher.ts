import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
import { formatPullRequestReview } from '../../../slack/format/pull-request-review.formatter';
import { ReviewPullRequestUsecase } from '../application/review-pull-request.usecase';
import { CodeReviewerException } from '../domain/code-reviewer.exception';
import { CodeReviewerErrorCode } from '../domain/code-reviewer-error-code.enum';
import { parsePrReference } from '../domain/pr-reference.parser';

// 콘솔에서 PR 미지정 시 최근 open PR을 조회하는 범위.
const AUTO_RESOLVE_LOOKBACK_DAYS = 180;

// CODE_REVIEWER worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 를 prRef 로 매핑.
// classifier 가 자연어에서 PR reference (owner/repo#N) 를 추출해 input.text 로 넘기는 가정.
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

    if (input.source === 'REMOTE_CONSOLE' && !isValidPrReference(prRef)) {
      const resolved = await this.resolveLatestOpenPrOrThrow();
      if (resolved) {
        prRef = resolved.prRef;
        autoResolvedNotice = resolved.notice;
      }
    }

    const outcome = await this.reviewPullRequest.execute({
      prRef,
      slackUserId: input.slackUserId,
      ...(input.conversationContext !== undefined
        ? { conversationContext: input.conversationContext }
        : {}),
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatPullRequestReview({
        prRef,
        review: outcome.result,
      }),
      ...(autoResolvedNotice !== undefined ? { autoResolvedNotice } : {}),
    };
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

const isValidPrReference = (raw: string): boolean => {
  try {
    parsePrReference(raw);
    return true;
  } catch {
    return false;
  }
};
