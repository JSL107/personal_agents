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
import { AgentType } from '../../model-router/domain/model-router.type';
import { buildNoFindingsCommentBody } from '../domain/finding-comment.body';
import { SweepPullRequestResult } from '../domain/publish-outcome.type';
import { PublishFindingsService } from './publish-findings.service';

// 스윕 1회에 새로 리뷰할 PR 최대 개수. LLM 호출 폭주를 막는 상한.
//
// 5 → 3: 스윕 주기를 15분에서 5분으로 줄이면서 함께 낮춘다. CLI 타임아웃이 300초(#198)라
// 최악 5건이면 1500초가 걸려 worker lockDuration(LONG_RUNNING_WORKER_LOCK_DURATION_MS, 690초)
// 을 넘기고, 그러면 BullMQ 가 stalled 로 보고 재큐하는 상황을 스스로 만든다. 3건이면 실측
// 리뷰 시간(30~140초) 기준 420초로 여유가 있다. 주기가 3분(2026-08-06)까지 짧아졌으므로
// 처리량은 시간당 20건 → 60건으로 오히려 는다.
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
// 실패(FAILED)/고착(IN_PROGRESS) 리뷰의 재시도 쿨다운. 이 레포의 PR 은 약 30분 안에
// merge 되므로 6시간 쿨다운은 첫 리뷰 실패를 merge 전까지 한 번도 재시도하지 못하게 해,
// `*/5` 스윕이 고치려던 바로 그 실패 시나리오를 남겼다. 10분이면 PR 수명 안에 2번 더
// 기회를 주고, CLI 타임아웃 300초(#198)보다 충분히 길어 아직 실행 중인 리뷰의 중복도 막는다.
const SWEEP_RETRY_COOLDOWN_MINUTES = 10;
// 짧은 쿨다운이 쿼터 소진 같은 지속 실패를 5분마다 영구 반복하지 않도록 24시간 실패/고착
// 시도를 3회로 제한한다. 기존 6시간 쿨다운의 하루 약 4회와 비슷한 총량을 유지하되,
// PR 이 아직 열려 있는 앞쪽에 시도를 모은다.
const SWEEP_RETRY_BUDGET_WINDOW_HOURS = 24;
const SWEEP_RETRY_BUDGET_MAX_ATTEMPTS = 3;
// GitHub 이 unified diff 를 내주는 상한. 넘으면 `pulls.get(mediaType: diff)` 가 406
// (`code: too_large`) 로 거절한다. 재시도해도 PR 이 작아지지 않는 한 결과가 같으므로,
// 실패 원인을 PR 상세의 additions+deletions 로 판별해 로그에 명시한다 — "diff 조회 실패"
// 만으로는 일시적 장애인지 구조적 한계인지 구분되지 않아 진단이 매번 처음부터 시작된다.
const GITHUB_DIFF_MAX_LINES = 20_000;

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
    const decision = this.judgeLatestReview(latest, this.isDryRun());
    if (
      decision === 'REVIEW' &&
      latest !== null &&
      latest.status !== AgentRunStatus.SUCCEEDED
    ) {
      return await this.judgeRetryBudget(prRef);
    }
    return decision;
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
    const cooldownMs = SWEEP_RETRY_COOLDOWN_MINUTES * 60 * 1000;
    const elapsedMs = Date.now() - latest.startedAt.getTime();
    return elapsedMs >= cooldownMs ? 'REVIEW' : 'SKIP';
  }

  // inputSnapshot.prRef JSON path 는 인덱스가 없으므로 common path 에서는 호출하지 않고,
  // 실패/고착 리뷰가 쿨다운을 지나 실제 재시도 직전일 때만 예산을 조회한다.
  private async judgeRetryBudget(prRef: string): Promise<SweepDecision> {
    try {
      const attempts = await this.agentRunService.countUnsuccessfulSweepReviews(
        {
          prRef,
          sinceHours: SWEEP_RETRY_BUDGET_WINDOW_HOURS,
        },
      );
      if (attempts >= SWEEP_RETRY_BUDGET_MAX_ATTEMPTS) {
        this.logger.warn(
          `스윕 재시도 예산 소진, 이번 스윕에서 skip (${prRef}, count=${attempts})`,
        );
        return 'SKIP';
      }
      return 'REVIEW';
    } catch (error: unknown) {
      this.logger.warn(
        `스윕 재시도 예산 조회 실패, 이번 스윕에서 skip (${prRef}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'SKIP';
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
    const dryRun = this.isDryRun();
    // 리뷰 usecase 는 자기 AgentRun 을 열고 실패 시 스스로 FAILED 로 마감한다. 그 지점을 넘은
    // 뒤의 실패까지 여기서 또 기록하면 한 번의 실패가 원장에 2건으로 남아 재시도 예산이 두 배
    // 속도로 닳는다. 원장에 기록될 주체가 아직 없는 구간(조회 단계)만 이 usecase 가 책임진다.
    let reviewUsecaseEntered = false;
    try {
      // 상세와 diff 는 병렬로 조회한다. 두 요청은 어차피 원자적이지 않아 그 사이 push 가
      // 들어오면 "옛 headSha + 새 diff" 스냅샷이 만들어지는데, 순차로 바꾸면 그 창이
      // 첫 요청의 왕복 시간만큼 넓어진다 — 창을 없앨 수는 없으므로 넓히지 않는 쪽을 택한다
      // (완전 해소는 headSha 에 고정된 diff 를 받는 별도 설계, 2026-08-04 리뷰 지적).
      // diff 는 실패할 수 있어 allSettled 로 받고, 원인은 상세의 변경량으로 판별한다.
      const [detailResult, diffResult] = await Promise.allSettled([
        this.githubClient.getPullRequest({ repo, number: pullNumber }),
        this.githubClient.getPullRequestDiff({ repo, number: pullNumber }),
      ]);
      if (detailResult.status === 'rejected') {
        throw detailResult.reason;
      }
      const detail = detailResult.value;
      if (diffResult.status === 'rejected') {
        const changedLines = detail.additions + detail.deletions;
        if (changedLines > GITHUB_DIFF_MAX_LINES) {
          throw new Error(
            `PR 변경량 ${changedLines}줄이 GitHub diff 한도(${GITHUB_DIFF_MAX_LINES}줄)를 넘어 리뷰할 수 없습니다.`,
          );
        }
        throw diffResult.reason;
      }
      const diff = diffResult.value;
      // 여기서 조회한 스냅샷을 리뷰에도 그대로 넘긴다 — 리뷰가 재조회하면 그 사이 push 된
      // 커밋 때문에 "지적은 새 diff 기준, 게시는 옛 headSha·옛 diff 기준"으로 갈려 인라인
      // 앵커가 어긋난다(2026-07-31 리뷰 지적).
      reviewUsecaseEntered = true;
      const outcome = await this.reviewPullRequestUsecase.execute({
        prRef,
        slackUserId,
        triggerType: TriggerType.PR_REVIEW_SWEEP,
        snapshot: { detail, diff },
        dryRun,
      });
      if (outcome.result.findings.length === 0) {
        await this.commentNoFindings({
          repo,
          pullNumber,
          prRef,
          dryRun,
          summary: outcome.result.summary,
        });
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
      if (!reviewUsecaseEntered) {
        await this.recordFailedSweepRun({
          prRef,
          repo,
          pullNumber,
          dryRun,
          error,
        });
      }
      return null;
    }
  }

  // 지적 0건이면 게시할 카드가 없어 PR 에 아무 흔적도 남지 않는다 — 받는 쪽에서 "깨끗하다" 와
  // "리뷰가 돌긴 했나" 가 구분되지 않는다(실측: #389·#1027·#1030 이 리뷰 성공 후 코멘트 0건).
  // 검토했고 고칠 것이 없었다는 사실만 코멘트로 남긴다.
  //
  // 같은 PR 에 반복해 달리지 않는다 — 성공한 리뷰는 SWEEP_REVIEW_LOOKBACK_DAYS 동안 SKIP 이고
  // (judgeLatestReview), 연습 모드 회차는 아래 dryRun 가드에서 걸러 실게시 전환 시 첫 1회만
  // 남는다. 예외는 그 lookback 을 넘겨 재리뷰되는 장수 PR 로, 지적 코멘트와 달리 이 안내에는
  // 지문 중복 방지가 없어 30일에 한 건씩 늘어난다 — 30분 안에 merge 되는 이 레포의 PR 수명상
  // 실사용 영향은 없다고 보고 받아들인다.
  //
  // 실패해도 스윕을 실패로 만들지 않는다. 리뷰 자체는 이미 SUCCEEDED 로 마감됐고, 이 코멘트는
  // 안내일 뿐이라 여기서 throw 하면 성공한 회차가 원장에 실패로 남아 재시도 예산만 닳는다.
  private async commentNoFindings({
    repo,
    pullNumber,
    prRef,
    dryRun,
    summary,
  }: {
    repo: string;
    pullNumber: number;
    prRef: string;
    dryRun: boolean;
    summary: string;
  }): Promise<void> {
    // 연습 모드는 GitHub 에 아무것도 남기지 않는 것이 정의다.
    if (dryRun) {
      return;
    }
    // 게시 허용 판정(isRepoAllowed)을 여기서 다시 하지 않는다 — 스윕이 도는 레포 목록 자체가
    // 같은 PR_REVIEW_INLINE_REPOS 에서 나오므로(allowlistRepos) 여기 닿은 레포는 이미 허용
    // 목록 안이다. 스윕 대상과 게시 허용을 다른 키로 가르는 변경이 오면 이 지점도 함께 봐야 한다.
    try {
      await this.githubClient.addIssueComment({
        repo,
        number: pullNumber,
        body: buildNoFindingsCommentBody(summary),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `지적 없음 코멘트 게시 실패 (${prRef}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 리뷰 usecase 에 닿기 전(GitHub 조회 단계)에 실패하면 AgentRun 이 아예 생기지 않는다.
  // 그러면 다음 스윕의 decideSweepAction 이 "한 번도 시도한 적 없는 PR" 로 판정해, 쿨다운과
  // 재시도 예산이 근거로 삼을 기록이 없어 `*/5` 스윕이 같은 실패를 영구 반복한다
  // (실측: diff 한도를 넘는 PR 하나가 하루 288회). 실패도 원장에 남겨 두 장치를 되살린다.
  //
  // 판정 질의가 inputSnapshot 의 `prRef` 로 조회하므로 리뷰 usecase 가 남기는 스냅샷과
  // 같은 키를 채워야 한다 — 키가 어긋나면 기록은 쌓이는데 판정은 여전히 못 찾는다.
  private async recordFailedSweepRun({
    prRef,
    repo,
    pullNumber,
    dryRun,
    error,
  }: {
    prRef: string;
    repo: string;
    pullNumber: number;
    dryRun: boolean;
    error: unknown;
  }): Promise<void> {
    try {
      await this.agentRunService.execute({
        agentType: AgentType.CODE_REVIEWER,
        triggerType: TriggerType.PR_REVIEW_SWEEP,
        inputSnapshot: { prRef, repo, pullNumber, dryRun },
        run: () => Promise.reject(error),
      });
    } catch (recordError: unknown) {
      // execute 는 FAILED 로 마감한 뒤 원인 오류를 그대로 다시 throw 한다. 기록이 목적이므로
      // 여기서 멈추되, 기록 자체가 실패(DB 장애 등)한 경우는 조용히 넘기지 않고 남긴다.
      if (recordError !== error) {
        this.logger.warn(
          `스윕 실패 기록 실패 (${prRef}): ${
            recordError instanceof Error
              ? recordError.message
              : String(recordError)
          }`,
        );
      }
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
