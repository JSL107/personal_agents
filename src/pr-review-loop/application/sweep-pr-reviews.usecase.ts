import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import { SweepPullRequestResult } from '../domain/publish-outcome.type';
import { PublishFindingsService } from './publish-findings.service';

// 스윕 1회에 새로 리뷰할 PR 최대 개수. LLM 호출 폭주를 막는 상한.
const NEW_REVIEW_LIMIT_PER_SWEEP = 5;
// 열린 PR 조회 기간. 오래 방치된 PR 까지 매번 훑지 않는다.
const OPEN_PR_LOOKBACK_DAYS = 14;
const OPEN_PR_FETCH_LIMIT = 20;
const DEFAULT_INLINE_MAX = 4;
// PR 당 리뷰 1회 판정(hasSweepReviewFor) 조회 기간. AgentRun.inputSnapshot 의 JSON path 필터는
// 인덱스가 없어 무기한 스캔을 피하려 최근 N일로 제한한다 — 열린 PR 조회 기간(14일)보다 여유를
// 둬 그 사이 재오픈/재조회되는 케이스를 놓치지 않는다.
const SWEEP_REVIEW_LOOKBACK_DAYS = 30;

@Injectable()
export class SweepPrReviewsUsecase {
  private readonly logger = new Logger(SweepPrReviewsUsecase.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly reviewPullRequestUsecase: ReviewPullRequestUsecase,
    private readonly agentRunService: AgentRunService,
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
        const prRef = `${pullRequest.repo}#${pullRequest.number}`;
        const alreadyReviewed = await this.hasAlreadySweptReview(prRef);
        // null = 판정 실패 — 오판으로 중복 리뷰하느니 이번 스윕에서 이 PR 만 건너뛴다(토큰 안전 방향).
        if (alreadyReviewed === null || alreadyReviewed) {
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

  // PR 당 리뷰 1회 판정 — AgentRun(triggerType=PR_REVIEW_SWEEP) 원장 기준. 게시 여부·findings
  // 유무와 무관하게 "리뷰 시도" 자체가 근거이므로 연습 모드(카드 미생성)에서도 정확히 동작한다.
  // 조회 자체가 실패하면 null 을 반환해 호출부가 그 PR 만 skip 하게 한다.
  private async hasAlreadySweptReview(prRef: string): Promise<boolean | null> {
    try {
      return await this.agentRunService.hasSweepReviewFor({
        prRef,
        sinceDays: SWEEP_REVIEW_LOOKBACK_DAYS,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `스윕 판정 조회 실패, 이번 스윕에서 skip (${prRef}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
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

  // 빈 문자열/공백(`PR_REVIEW_INLINE_MAX=` 처럼 값 없이 키만 있는 흔한 .env 상태)은 미설정과
  // 동일하게 취급한다 — Number('') 은 0 이라 가드를 통과해 max:0(전량 dropped)이 되는 것을 막는다.
  // 명시적 '0'(게시 안 함)은 여전히 유효한 의도로 허용한다.
  private inlineMax(): number {
    const raw = this.configService.get<string>('PR_REVIEW_INLINE_MAX');
    if (raw === undefined || raw.trim().length === 0) {
      return DEFAULT_INLINE_MAX;
    }
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
