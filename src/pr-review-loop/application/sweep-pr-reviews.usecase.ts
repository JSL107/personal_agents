import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import {
  PR_REVIEW_FINDING_REPOSITORY_PORT,
  PrReviewFindingRepositoryPort,
} from '../domain/port/pr-review-finding.repository.port';
import { SweepPullRequestResult } from '../domain/publish-outcome.type';
import { PublishFindingsService } from './publish-findings.service';

// 스윕 1회에 새로 리뷰할 PR 최대 개수. LLM 호출 폭주를 막는 상한.
const NEW_REVIEW_LIMIT_PER_SWEEP = 5;
// 열린 PR 조회 기간. 오래 방치된 PR 까지 매번 훑지 않는다.
const OPEN_PR_LOOKBACK_DAYS = 14;
const OPEN_PR_FETCH_LIMIT = 20;
const DEFAULT_INLINE_MAX = 4;

@Injectable()
export class SweepPrReviewsUsecase {
  private readonly logger = new Logger(SweepPrReviewsUsecase.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly reviewPullRequestUsecase: ReviewPullRequestUsecase,
    @Inject(PR_REVIEW_FINDING_REPOSITORY_PORT)
    private readonly repository: PrReviewFindingRepositoryPort,
    private readonly publishService: PublishFindingsService,
    private readonly configService: ConfigService,
  ) {}

  async execute(): Promise<SweepPullRequestResult[]> {
    if (!this.isEnabled()) {
      return [];
    }
    const ownerLogin = this.configService.get<string>(
      'GITHUB_WEBHOOK_OWNER_LOGIN',
    );
    const slackUserId = this.configService.get<string>(
      'AUTOPILOT_OWNER_SLACK_USER_ID',
    );
    if (!ownerLogin || !slackUserId) {
      this.logger.warn(
        'owner login 또는 Slack owner id 미설정 — PR 리뷰 스윕 skip',
      );
      return [];
    }

    const repos = this.allowlistRepos();
    if (repos.length === 0) {
      return [];
    }

    const results: SweepPullRequestResult[] = [];
    let reviewed = 0;

    for (const repo of repos) {
      if (reviewed >= NEW_REVIEW_LIMIT_PER_SWEEP) {
        break;
      }
      const pullRequests = await this.listOpenPullRequests({
        repo,
        ownerLogin,
      });
      for (const pullRequest of pullRequests) {
        if (reviewed >= NEW_REVIEW_LIMIT_PER_SWEEP) {
          break;
        }
        const alreadyReviewed = await this.repository.hasAnyForPullRequest({
          repo: pullRequest.repo,
          pullNumber: pullRequest.number,
        });
        if (alreadyReviewed) {
          continue;
        }
        reviewed += 1;
        const result = await this.reviewAndPublish({
          repo: pullRequest.repo,
          pullNumber: pullRequest.number,
          slackUserId,
        });
        if (result !== null) {
          results.push(result);
        }
      }
    }

    return results;
  }

  private async listOpenPullRequests({
    repo,
    ownerLogin,
  }: {
    repo: string;
    ownerLogin: string;
  }) {
    const since = new Date(
      Date.now() - OPEN_PR_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    try {
      return await this.githubClient.listAuthorOpenPullRequests({
        repo,
        author: ownerLogin,
        sinceIsoDate: since,
        limit: OPEN_PR_FETCH_LIMIT,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `열린 PR 조회 실패 (${repo}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // 한 PR 의 실패가 스윕 전체를 멈추지 않게 격리한다.
  private async reviewAndPublish({
    repo,
    pullNumber,
    slackUserId,
  }: {
    repo: string;
    pullNumber: number;
    slackUserId: string;
  }): Promise<SweepPullRequestResult | null> {
    const prRef = `${repo}#${pullNumber}`;
    try {
      const [detail, diff] = await Promise.all([
        this.githubClient.getPullRequest({ repo, number: pullNumber }),
        this.githubClient.getPullRequestDiff({ repo, number: pullNumber }),
      ]);
      const outcome = await this.reviewPullRequestUsecase.execute({
        prRef,
        slackUserId,
        triggerType: TriggerType.PR_REVIEW_SWEEP,
      });
      if (outcome.result.findings.length === 0) {
        return null;
      }
      const published = await this.publishService.publish({
        agentRunId: outcome.agentRunId,
        repo,
        pullNumber,
        headSha: detail.headSha,
        diff: diff.diff,
        findings: outcome.result.findings,
        max: this.inlineMax(),
        dryRun: this.isDryRun(),
        allowlistRaw: this.configService.get<string>('PR_REVIEW_INLINE_REPOS'),
      });
      return {
        prRef,
        riskLevel: outcome.result.riskLevel,
        outcome: published,
      };
    } catch (error: unknown) {
      this.logger.error(
        `PR 리뷰 스윕 실패 (${prRef}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private isEnabled(): boolean {
    return this.configService.get<string>('PR_REVIEW_LOOP_ENABLED') === 'true';
  }

  // 기본 true — 명시적으로 'false' 일 때만 실게시. 연습 모드가 기본값이다.
  private isDryRun(): boolean {
    return (
      this.configService.get<string>('PR_REVIEW_INLINE_DRYRUN') !== 'false'
    );
  }

  private inlineMax(): number {
    const raw = this.configService.get<string>('PR_REVIEW_INLINE_MAX');
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return DEFAULT_INLINE_MAX;
    }
    return parsed;
  }

  private allowlistRepos(): string[] {
    const raw = this.configService.get<string>('PR_REVIEW_INLINE_REPOS');
    if (!raw) {
      return [];
    }
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}
