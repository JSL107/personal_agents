import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import {
  AgentRunStatus,
  TriggerType,
} from '../../agent-run/domain/agent-run.type';
import { LatestSweepReview } from '../../agent-run/domain/port/agent-run.repository.port';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import { SweepPullRequestResult } from '../domain/publish-outcome.type';
import { PublishFindingsService } from './publish-findings.service';

// 스윕 1회에 새로 리뷰할 PR 최대 개수. LLM 호출 폭주를 막는 상한.
//
// 5 → 3: 스윕 주기를 15분에서 5분으로 줄이면서 함께 낮춘다. CLI 타임아웃이 300초(#198)라
// 최악 5건이면 1500초가 걸려 worker lockDuration(450초)을 크게 넘기고, 그러면 BullMQ 가
// stalled 로 보고 재큐하는 상황을 스스로 만든다. 3건이면 실측 리뷰 시간(30~80초) 기준
// 240초로 여유가 있다. 주기가 3배 짧아졌으므로 처리량은 시간당 20건 → 36건으로 오히려 는다.
const NEW_REVIEW_LIMIT_PER_SWEEP = 3;
// 열린 PR 조회 기간. 오래 방치된 PR 까지 매번 훑지 않는다.
const OPEN_PR_LOOKBACK_DAYS = 14;
const OPEN_PR_FETCH_LIMIT = 20;
const DEFAULT_INLINE_MAX = 4;
// PR 당 리뷰 1회(쿨다운 재시도) 판정(findLatestSweepReview) 조회 기간. AgentRun.inputSnapshot 의
// JSON path 필터는 인덱스가 없어 무기한 스캔을 피하려 최근 N일로 제한한다. 단, 열린 PR 조회의
// sinceIsoDate 는 GitHub `updated:>=`(갱신 시각) 기준이라 — 이 lookback(30일) 보다 오래 전에
// 열렸어도 계속 활동(commit/코멘트)이 있는 PR 은 open-PR 조회에는 계속 걸리는데 이 판정 lookback
// 밖으로 나가 약 30일마다 재리뷰될 수 있다. 실사용 영향은 작다고 보고(월 1회 수준) 받아들이는
// 절충이다 — "두 lookback 이 정합적이라 문제 없음"이 아니라 의도적 트레이드오프임을 밝혀둔다.
const SWEEP_REVIEW_LOOKBACK_DAYS = 30;
// 실패(FAILED)/고착(IN_PROGRESS) 리뷰의 재시도 쿨다운. 실패를 영구 제외하면 일시적 codex
// 오류(쿼터 소진, 절전 복귀 직후 미준비 등 이 레포에서 실제로 나는 유형) 하나로 PR 이
// SWEEP_REVIEW_LOOKBACK_DAYS(30일)간 빠지고, 무조건 재시도하면 15분마다 실패를 반복해
// 무한 루프가 실패 경로로 되살아난다 — 쿨다운으로 둘 사이를 잡는다. 하루 최대 4회 재시도.
const SWEEP_RETRY_COOLDOWN_HOURS = 6;

// 판정 헬퍼의 반환값 — 조회 실패와 "레코드 없음"을 섞지 않기 위해 boolean/null 대신 명시적 열거.
type SweepDecision = 'REVIEW' | 'SKIP';

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
        const decision = await this.decideSweepAction(prRef);
        if (decision === 'SKIP') {
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

  // PR 당 리뷰 1회(쿨다운 재시도) 판정 — AgentRun(triggerType=PR_REVIEW_SWEEP) 원장 기준.
  // 게시 여부·findings 유무와 무관하게 "리뷰 시도" 자체가 근거이므로 연습 모드(카드 미생성)에서도
  // 정확히 동작한다. 레코드가 없으면 REVIEW, SUCCEEDED 면 SKIP(단 연습 모드로 끝난 리뷰는
  // 실게시 전환 시 한 번 더 REVIEW), 그 외(FAILED/IN_PROGRESS)는 쿨다운이 지났는지로 재시도
  // 여부를 가른다(순수 로직 — 조회는 조회대로, 판정은 판정대로 분리).
  // 조회 자체가 실패하면 오판으로 중복 리뷰하느니 SKIP — 이번 스윕에서 이 PR 만 건너뛴다.
  private async decideSweepAction(prRef: string): Promise<SweepDecision> {
    let latest: LatestSweepReview | null;
    try {
      latest = await this.agentRunService.findLatestSweepReview({
        prRef,
        sinceDays: SWEEP_REVIEW_LOOKBACK_DAYS,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `스윕 판정 조회 실패, 이번 스윕에서 skip (${prRef}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'SKIP';
    }
    return this.judgeLatestReview(latest, this.isDryRun());
  }

  private judgeLatestReview(
    latest: LatestSweepReview | null,
    currentDryRun: boolean,
  ): SweepDecision {
    if (latest === null) {
      return 'REVIEW';
    }
    if (latest.status === AgentRunStatus.SUCCEEDED) {
      // 연습 모드로 끝난 리뷰는 GitHub 에 아무것도 남기지 않았다. 그 상태를 "리뷰 완료"로
      // 굳히면 실게시로 전환한 뒤에도 같은 PR 이 SWEEP_REVIEW_LOOKBACK_DAYS(30일)간
      // SKIP 되어 영영 게시되지 않는다 — 연습 → 실게시 전환은 기본값이 연습 모드인
      // 이 기능에서 반드시 밟는 경로이므로, 그 한 번은 다시 리뷰해 게시한다.
      return latest.dryRun && !currentDryRun ? 'REVIEW' : 'SKIP';
    }
    const cooldownMs = SWEEP_RETRY_COOLDOWN_HOURS * 60 * 60 * 1000;
    const elapsedMs = Date.now() - latest.startedAt.getTime();
    return elapsedMs >= cooldownMs ? 'REVIEW' : 'SKIP';
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
    const dryRun = this.isDryRun();
    try {
      const [detail, diff] = await Promise.all([
        this.githubClient.getPullRequest({ repo, number: pullNumber }),
        this.githubClient.getPullRequestDiff({ repo, number: pullNumber }),
      ]);
      // 여기서 조회한 스냅샷을 리뷰에도 그대로 넘긴다 — 리뷰가 재조회하면 그 사이 push 된
      // 커밋 때문에 "지적은 새 diff 기준, 게시는 옛 headSha·옛 diff 기준"으로 갈려 인라인
      // 앵커가 어긋난다(2026-07-31 리뷰 지적).
      const outcome = await this.reviewPullRequestUsecase.execute({
        prRef,
        slackUserId,
        triggerType: TriggerType.PR_REVIEW_SWEEP,
        snapshot: { detail, diff },
        dryRun,
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
        dryRun,
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
