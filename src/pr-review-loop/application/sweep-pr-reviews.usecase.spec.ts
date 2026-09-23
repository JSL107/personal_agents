import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { CodexQuotaExceededException } from '../../model-router/infrastructure/codex-cli.provider';
import { PublishFindingsService } from './publish-findings.service';
import { SweepPrReviewsUsecase } from './sweep-pr-reviews.usecase';

// 스윕이 조회에서 받는 값은 식별자뿐이다 — 상세(title/body/증감)는 받지 않는다.
const OPEN_PR = {
  number: 180,
  repo: 'JSL107/personal_agents',
  updatedAt: '2026-07-31T00:00:00Z',
  isDraft: false,
};
const OPEN_PR_URL = 'https://github.com/JSL107/personal_agents/pull/180';

// PR 상세. 원장에 남길 draft 여부는 검색 결과가 아니라 이 상세에서 취하므로, draft 관련
// 테스트는 이 값을 갈아끼워 검색과 상세가 엇갈리는 상황까지 만든다.
const DETAIL = {
  number: 180,
  title: 'feat: 무언가',
  body: '',
  repo: 'JSL107/personal_agents',
  url: OPEN_PR_URL,
  baseRef: 'main',
  baseSha: 'base-sha-main',
  headRef: 'feat/x',
  headSha: 'abc1234',
  authorLogin: 'JSL107',
  mergedAt: null,
  changedFiles: ['src/foo.service.ts'],
  changedFilesTruncated: false,
  changedFilesTotalCount: 1,
  additions: 10,
  deletions: 2,
  isDraft: false,
};

const REVIEW_OUTCOME = {
  agentRunId: 7,
  modelUsed: 'gpt-5.4',
  result: {
    summary: '요약',
    riskLevel: 'high' as const,
    mustFix: ['m'],
    niceToHave: [],
    missingTests: [],
    reviewCommentDrafts: [],
    approvalRecommendation: 'request_changes' as const,
    findings: [
      {
        category: 'RELIABILITY' as const,
        severity: 'MUST_FIX' as const,
        file: 'src/foo.service.ts',
        line: 12,
        body: '트랜잭션 밖에서 저장한다',
      },
    ],
  },
};

const buildConfig = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('SweepPrReviewsUsecase', () => {
  let github: jest.Mocked<
    Pick<
      GithubClientPort,
      | 'listOpenPullRequestRefs'
      | 'getPullRequest'
      | 'getPullRequestDiff'
      | 'addIssueComment'
    >
  >;
  let reviewUsecase: jest.Mocked<Pick<ReviewPullRequestUsecase, 'execute'>>;
  let agentRunService: jest.Mocked<
    Pick<
      AgentRunService,
      'findLatestSweepReview' | 'countUnsuccessfulSweepReviews' | 'execute'
    >
  >;
  let publishService: jest.Mocked<Pick<PublishFindingsService, 'publish'>>;

  // 판정 테스트용 — 절대 시각이 아닌 "현재로부터 N시간/분 전"으로 만들어 시간 흐름에
  // 영향받지 않게 한다.
  const hoursAgo = (hours: number): Date =>
    new Date(Date.now() - hours * 60 * 60 * 1000);
  const minutesAgo = (minutes: number): Date =>
    new Date(Date.now() - minutes * 60 * 1000);

  const buildUsecase = (values: Record<string, string | undefined>) =>
    new SweepPrReviewsUsecase(
      github as unknown as GithubClientPort,
      reviewUsecase as unknown as ReviewPullRequestUsecase,
      agentRunService as unknown as AgentRunService,
      publishService as unknown as PublishFindingsService,
      buildConfig(values),
    );

  const ENABLED = {
    PR_REVIEW_LOOP_ENABLED: 'true',
    PR_REVIEW_INLINE_REPOS: 'JSL107/personal_agents',
    PR_REVIEW_INLINE_DRYRUN: 'true',
    PR_REVIEW_INLINE_MAX: '4',
    GITHUB_WEBHOOK_OWNER_LOGIN: 'JSL107',
    AUTOPILOT_OWNER_SLACK_USER_ID: 'U123',
  };

  beforeEach(() => {
    github = {
      listOpenPullRequestRefs: jest.fn().mockResolvedValue([OPEN_PR]),
      getPullRequest: jest.fn().mockResolvedValue(DETAIL),
      getPullRequestDiff: jest
        .fn()
        .mockResolvedValue({ diff: 'diff', truncated: false, bytes: 4 }),
      addIssueComment: jest.fn().mockResolvedValue(undefined),
    } as never;
    reviewUsecase = { execute: jest.fn().mockResolvedValue(REVIEW_OUTCOME) };
    // 판정은 AgentRun(triggerType=PR_REVIEW_SWEEP) 원장 기준 — 카드(PrReviewFinding) 유무와
    // 무관하다(연습 모드·findings 0건에서도 카드는 안 생기지만 이 판정은 정상 동작해야 한다).
    // 기본값 null = 이전 스윕 리뷰 레코드 없음 → 리뷰 대상.
    agentRunService = {
      findLatestSweepReview: jest.fn().mockResolvedValue(null),
      countUnsuccessfulSweepReviews: jest.fn().mockResolvedValue(0),
      // 실제 execute 는 run 콜백이 throw 하면 FAILED 로 마감한 뒤 원인 오류를 그대로 다시
      // throw 한다. 실패 기록 경로가 그 계약 위에서 동작하므로 mock 도 run 을 실행해 흉내낸다.
      execute: jest
        .fn()
        .mockImplementation(({ run }) => run({ agentRunId: 99 })),
    } as never;
    publishService = {
      publish: jest.fn().mockResolvedValue({
        inline: 0,
        file: 0,
        issueComment: 0,
        dryRun: 1,
        notPosted: 0,
        dropped: 0,
        duplicate: 0,
      }),
    };
  });

  it('마스터 스위치가 꺼져 있으면 아무것도 하지 않는다', async () => {
    const { results } = await buildUsecase({
      ...ENABLED,
      PR_REVIEW_LOOP_ENABLED: 'false',
    }).execute();

    expect(results).toEqual([]);
    expect(github.listOpenPullRequestRefs).not.toHaveBeenCalled();
  });

  it('owner login 이 없으면 아무것도 하지 않는다', async () => {
    const { results } = await buildUsecase({
      ...ENABLED,
      GITHUB_WEBHOOK_OWNER_LOGIN: undefined,
    }).execute();

    expect(results).toEqual([]);
  });

  it('Slack owner id 가 없으면 아무것도 하지 않는다', async () => {
    const { results } = await buildUsecase({
      ...ENABLED,
      AUTOPILOT_OWNER_SLACK_USER_ID: undefined,
    }).execute();

    expect(results).toEqual([]);
    expect(github.listOpenPullRequestRefs).not.toHaveBeenCalled();
  });

  it('allowlist 가 비어 있으면 스윕 자체를 하지 않는다', async () => {
    const { results } = await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_REPOS: undefined,
    }).execute();

    expect(results).toEqual([]);
    expect(github.listOpenPullRequestRefs).not.toHaveBeenCalled();
  });

  it('allowlist 레포의 열린 PR 을 리뷰하고 게시 서비스에 넘긴다 (레코드 없음 → 리뷰함)', async () => {
    const { results } = await buildUsecase(ENABLED).execute();

    expect(agentRunService.findLatestSweepReview).toHaveBeenCalledWith({
      prRef: 'JSL107/personal_agents#180',
      sinceDays: 30,
    });
    expect(
      agentRunService.countUnsuccessfulSweepReviews,
    ).not.toHaveBeenCalled();
    expect(reviewUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        prRef: 'JSL107/personal_agents#180',
        triggerType: 'PR_REVIEW_SWEEP',
      }),
    );
    // 게시(headSha·diff)와 리뷰가 같은 스냅샷을 보게 조회 결과를 그대로 넘긴다 —
    // 리뷰가 재조회하면 그 사이 push 된 커밋으로 앵커 기준이 갈린다.
    const reviewArg = reviewUsecase.execute.mock.calls[0][0];
    expect(reviewArg.snapshot?.detail.headSha).toBe('abc1234');
    expect(reviewArg.snapshot?.diff.diff).toBe('diff');
    expect(reviewArg.dryRun).toBe(true);
    expect(github.getPullRequest).toHaveBeenCalledTimes(1);
    expect(reviewUsecase.execute).toHaveBeenCalledWith(
      expect.not.objectContaining({ publish: expect.anything() }),
    );
    expect(publishService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRunId: 7,
        headSha: 'abc1234',
        dryRun: true,
        max: 4,
      }),
    );
    expect(results).toEqual([
      expect.objectContaining({
        prRef: 'JSL107/personal_agents#180',
        riskLevel: 'high',
      }),
    ]);
  });

  it('직전 스윕 리뷰가 SUCCEEDED 면 다시 리뷰하지 않는다 — PR 당 리뷰 1회', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'SUCCEEDED',
      startedAt: hoursAgo(1),
      dryRun: false,
      isDraft: false,
      errorCode: null,
    });

    const { results } = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(
      agentRunService.countUnsuccessfulSweepReviews,
    ).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('연습 모드(dry-run 기본값)에서도 SUCCEEDED 판정은 동일하게 skip 된다 — 카드 유무와 무관', async () => {
    // ENABLED 는 PR_REVIEW_INLINE_DRYRUN: 'true' — 카드가 절대 생기지 않는 경로.
    // findLatestSweepReview 만으로 재리뷰가 막히는지 확인한다(카드 조회에 의존하지 않음을 증명).
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'SUCCEEDED',
      startedAt: hoursAgo(1),
      dryRun: true,
      isDraft: false,
      errorCode: null,
    });

    await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
  });

  it('실게시 모드에서도 SUCCEEDED 판정은 동일하게 skip 된다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'SUCCEEDED',
      startedAt: hoursAgo(1),
      dryRun: false,
      isDraft: false,
      errorCode: null,
    });

    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_DRYRUN: 'false',
    }).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
  });

  it('연습 모드로 끝난 SUCCEEDED 는 실게시로 전환하면 다시 리뷰한다 — 연습분이 영영 미게시로 남지 않게', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'SUCCEEDED',
      startedAt: hoursAgo(1),
      dryRun: true,
      isDraft: false,
      errorCode: null,
    });

    const { results } = await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_DRYRUN: 'false',
    }).execute();

    expect(
      agentRunService.countUnsuccessfulSweepReviews,
    ).not.toHaveBeenCalled();
    expect(reviewUsecase.execute).toHaveBeenCalledTimes(1);
    expect(publishService.publish).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
    expect(results).toHaveLength(1);
  });

  it('연습 모드로 끝난 SUCCEEDED 라도 여전히 연습 모드면 재리뷰하지 않는다 — 5분마다 재리뷰 방지', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'SUCCEEDED',
      startedAt: hoursAgo(1),
      dryRun: true,
      isDraft: false,
      errorCode: null,
    });

    await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
  });

  // draft 가 리뷰 대상이 되면서 "PR 당 1회" 와 충돌한다. 이 레포의 PR 은 열린 지 10~20분에
  // 머지되므로, draft 구간을 스치며 받은 미완성 리뷰가 그 PR 의 유일한 리뷰가 되면 정작
  // 머지되는 완성본이 검토 없이 나간다 — ready 전환 때 한 번을 더 준다.
  it('draft 로 끝난 SUCCEEDED 는 ready 로 바뀌면 다시 리뷰한다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'SUCCEEDED',
      startedAt: hoursAgo(1),
      dryRun: false,
      isDraft: true,
      errorCode: null,
    });
    github.listOpenPullRequestRefs.mockResolvedValue([
      { ...OPEN_PR, isDraft: false },
    ]);

    const { results } = await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_DRYRUN: 'false',
    }).execute();

    // 성공 레코드를 근거로 한 재리뷰라 재시도 예산(실패 경로)은 건드리지 않아야 한다.
    expect(
      agentRunService.countUnsuccessfulSweepReviews,
    ).not.toHaveBeenCalled();
    expect(reviewUsecase.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('draft 로 끝난 SUCCEEDED 라도 아직 draft 면 재리뷰하지 않는다 — 5분마다 재리뷰 방지', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'SUCCEEDED',
      startedAt: hoursAgo(1),
      dryRun: false,
      isDraft: true,
      errorCode: null,
    });
    github.listOpenPullRequestRefs.mockResolvedValue([
      { ...OPEN_PR, isDraft: true },
    ]);

    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_DRYRUN: 'false',
    }).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
  });

  // 완성본을 이미 리뷰한 PR 을 draft 로 되돌리는 경우. 되돌림은 전환이 아니므로 추가 리뷰가
  // 없어야 한다 — 성립시키면 draft ↔ ready 왕복만으로 코멘트를 무한히 쌓을 수 있다.
  it('ready 로 리뷰를 마친 PR 이 draft 로 되돌아가면 재리뷰하지 않는다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'SUCCEEDED',
      startedAt: hoursAgo(1),
      dryRun: false,
      isDraft: false,
      errorCode: null,
    });
    github.listOpenPullRequestRefs.mockResolvedValue([
      { ...OPEN_PR, isDraft: true },
    ]);

    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_DRYRUN: 'false',
    }).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
  });

  // 위 판정들이 딛고 선 근거다. 원장에 안 남으면 다음 회차가 "draft 때 리뷰했다"를 알 수 없어
  // ready 전환 재리뷰가 통째로 죽는다(조용히 — 그때는 그냥 SKIP 으로 보인다).
  it('draft PR 을 리뷰하면 원장에 draft 였음을 남긴다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue(null);
    github.listOpenPullRequestRefs.mockResolvedValue([
      { ...OPEN_PR, isDraft: true },
    ]);
    github.getPullRequest.mockResolvedValue({ ...DETAIL, isDraft: true });

    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_DRYRUN: 'false',
    }).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ isDraft: true }),
    );
  });

  // 후보 선별(검색)과 원장 기록(상세)이 서로 다른 시점을 본다. GitHub 검색 인덱스는 조금
  // 늦어 ready 가 된 PR 이 draft 로 조회될 수 있는데(같은 지연을 mergedAt 가드가 이미 전제로
  // 둔다), 그 값을 기록하면 완성본을 리뷰하고도 다음 회차에 ready 전환 재리뷰가 또 돌아
  // 같은 코드에 리뷰가 두 벌 게시된다.
  it('검색이 draft 로 줘도 상세가 ready 면 원장에는 ready 로 남긴다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue(null);
    github.listOpenPullRequestRefs.mockResolvedValue([
      { ...OPEN_PR, isDraft: true },
    ]);
    github.getPullRequest.mockResolvedValue({ ...DETAIL, isDraft: false });

    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_DRYRUN: 'false',
    }).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ isDraft: false }),
    );
  });

  it('직전이 FAILED + 쿨다운(10분) 안이면 재리뷰하지 않는다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'FAILED',
      startedAt: minutesAgo(5),
      dryRun: false,
      isDraft: false,
      errorCode: null,
    });

    const { results } = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('직전이 FAILED + 쿨다운(10분) 지나면 재리뷰한다 — 일시적 codex 실패가 PR 수명 동안 제외되지 않는다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'FAILED',
      startedAt: minutesAgo(15),
      dryRun: false,
      isDraft: false,
      errorCode: null,
    });

    const { results } = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('직전이 IN_PROGRESS + 쿨다운(10분) 안이면 재리뷰하지 않는다 — 진행 중 중복 리뷰 방지', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'IN_PROGRESS',
      startedAt: minutesAgo(5),
      dryRun: false,
      isDraft: false,
      errorCode: null,
    });

    const { results } = await buildUsecase(ENABLED).execute();

    expect(
      agentRunService.countUnsuccessfulSweepReviews,
    ).not.toHaveBeenCalled();
    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('쿨다운은 지났어도 24시간 재시도 예산(3회)을 다 쓰면 재리뷰하지 않는다 — 쿼터 소진 시 5분마다 실패 반복 방지', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'FAILED',
      startedAt: minutesAgo(15),
      dryRun: false,
      isDraft: false,
      errorCode: null,
    });
    agentRunService.countUnsuccessfulSweepReviews.mockResolvedValue(3);

    const { results } = await buildUsecase(ENABLED).execute();

    expect(agentRunService.countUnsuccessfulSweepReviews).toHaveBeenCalledWith({
      prRef: 'JSL107/personal_agents#180',
      sinceHours: 24,
    });
    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('쿨다운이 지났고 24시간 재시도 예산이 남으면 한 번 재리뷰한다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'IN_PROGRESS',
      startedAt: minutesAgo(15),
      dryRun: false,
      isDraft: false,
      errorCode: null,
    });
    agentRunService.countUnsuccessfulSweepReviews.mockResolvedValue(2);

    const { results } = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('변경량 초과로 끝났고 그 뒤 PR 갱신이 없으면 쿨다운이 지나도 재리뷰하지 않는다', async () => {
    // OPEN_PR.updatedAt 은 2026-07-31 로 실패 시각(15분 전)보다 앞선다 = 입력이 그대로다.
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'FAILED',
      startedAt: minutesAgo(15),
      dryRun: false,
      isDraft: false,
      errorCode: 'CODE_REVIEWER_DIFF_TOO_LARGE',
    });

    const { results } = await buildUsecase(ENABLED).execute();

    // 예산 조회까지 가지 않는다. 예산은 반복 속도만 늦출 뿐 멈추지 못한다 — 24시간 윈도우가
    // 롤링이라 오늘 쓴 3건이 내일 3건을 그대로 허가한다(실측 2026-09-17~23, 같은 PR 21회).
    expect(
      agentRunService.countUnsuccessfulSweepReviews,
    ).not.toHaveBeenCalled();
    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('변경량 초과로 실패했어도 그 뒤 PR 이 갱신됐으면 한 번 더 리뷰한다 — 한도 아래로 줄었을 수 있다', async () => {
    github.listOpenPullRequestRefs.mockResolvedValue([
      { ...OPEN_PR, updatedAt: minutesAgo(5).toISOString() },
    ]);
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'FAILED',
      startedAt: minutesAgo(15),
      dryRun: false,
      isDraft: false,
      errorCode: 'CODE_REVIEWER_DIFF_TOO_LARGE',
    });

    const { results } = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('갱신 시각을 읽을 수 없으면 갱신되지 않은 것으로 보고 차단을 유지한다', async () => {
    // 모를 때 재시도 쪽으로 열어두면 막으려던 무한 반복이 그대로 되돌아온다.
    github.listOpenPullRequestRefs.mockResolvedValue([
      { ...OPEN_PR, updatedAt: '' },
    ]);
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'FAILED',
      startedAt: minutesAgo(15),
      dryRun: false,
      isDraft: false,
      errorCode: 'CODE_REVIEWER_DIFF_TOO_LARGE',
    });

    const { results } = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('변경량 초과가 아닌 실패는 코드가 남아 있어도 쿨다운 재시도를 유지한다', async () => {
    // 영구 실패 차단이 실패 전체로 번지면 일시 장애(모델 출력 깨짐·쿼터·타임아웃)로 실패한
    // PR 까지 영영 리뷰되지 않는다. 차단 대상은 변경량 초과 하나뿐임을 고정한다.
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'FAILED',
      startedAt: minutesAgo(15),
      dryRun: false,
      isDraft: false,
      errorCode: 'CODE_REVIEWER_INVALID_MODEL_OUTPUT',
    });
    agentRunService.countUnsuccessfulSweepReviews.mockResolvedValue(0);

    const { results } = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('재시도 예산 조회가 실패하면 보수적으로 재리뷰하지 않는다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'FAILED',
      startedAt: minutesAgo(15),
      dryRun: false,
      isDraft: false,
      errorCode: null,
    });
    agentRunService.countUnsuccessfulSweepReviews.mockRejectedValue(
      new Error('DB 순간 오류'),
    );

    const { results } = await buildUsecase(ENABLED).execute();

    expect(agentRunService.countUnsuccessfulSweepReviews).toHaveBeenCalledWith({
      prRef: 'JSL107/personal_agents#180',
      sinceHours: 24,
    });
    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('스윕 1회의 신규 리뷰는 상한(3건)까지만', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...OPEN_PR,
      number: 200 + index,
    }));
    github.listOpenPullRequestRefs.mockResolvedValue(many);

    await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(3);
  });

  it('레포 간 상한(3건)은 합산으로 적용된다', async () => {
    const buildPrsForRepo = (repo: string) =>
      Array.from({ length: 3 }, (_, index) => ({
        ...OPEN_PR,
        repo,
        number: 100 + index,
      }));
    github.listOpenPullRequestRefs.mockResolvedValue([
      ...buildPrsForRepo('org/repo-a'),
      ...buildPrsForRepo('org/repo-b'),
      ...buildPrsForRepo('org/repo-c'),
    ]);

    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_REPOS: 'org/repo-a,org/repo-b,org/repo-c',
    }).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(3);
  });

  // 레포마다 검색을 따로 치던 경로가 3 분 주기 스윕에서 GitHub secondary rate limit 을
  // 불러 열린 PR 조회가 통째로 실패하고 있었다(실측 로그: 332ms 간격 연속 403).
  it('레포가 여러 개여도 열린 PR 조회는 한 번만 한다', async () => {
    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_REPOS: 'org/repo-a,org/repo-b,org/repo-c',
    }).execute();

    expect(github.listOpenPullRequestRefs).toHaveBeenCalledTimes(1);
    expect(github.listOpenPullRequestRefs).toHaveBeenCalledWith({
      repos: ['org/repo-a', 'org/repo-b', 'org/repo-c'],
      author: 'JSL107',
      sinceIsoDate: expect.any(String),
      limit: 50,
    });
  });

  // 조회가 식별자만 받게 되면서 merged_at 으로 걸러 주던 자리가 사라졌다. 검색 인덱스
  // 지연으로 `is:open` 에 남은 머지된 PR 에 리뷰 코멘트가 달리면 되돌릴 수 없다.
  it('검색 결과에 남은 머지된 PR 은 리뷰하지 않는다', async () => {
    const detail = await github.getPullRequest({
      repo: 'JSL107/personal_agents',
      number: 180,
    });
    github.getPullRequest.mockResolvedValue({
      ...detail,
      mergedAt: '2026-09-01T00:00:00Z',
    });

    const { results } = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(publishService.publish).not.toHaveBeenCalled();
    expect(results).toEqual([]);
    // 실패가 아니므로 원장에 실패로 남기지 않는다 — 재시도 예산이 닳으면 안 된다.
    expect(agentRunService.execute).not.toHaveBeenCalled();
  });

  // 머지 skip 이 회차 상한(3건)을 먹으면, 검색 인덱스에 남은 머지 결과 몇 건만으로 그 회차의
  // 정상 PR 이 통째로 밀린다 — 리뷰를 시작한 적이 없으므로 상한을 돌려줘야 한다.
  it('앞쪽 머지된 PR 은 회차 상한을 소모하지 않고 뒤의 열린 PR 을 리뷰한다', async () => {
    github.listOpenPullRequestRefs.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({
        ...OPEN_PR,
        number: 190 + index,
      })),
    );
    const detail = await github.getPullRequest({
      repo: 'JSL107/personal_agents',
      number: 180,
    });
    const merged = { ...detail, mergedAt: '2026-09-01T00:00:00Z' };
    // 앞의 3건은 이미 머지된 상태로 돌아오고, 그 뒤부터는 기본 mock(열린 PR)이 쓰인다.
    github.getPullRequest
      .mockResolvedValueOnce(merged)
      .mockResolvedValueOnce(merged)
      .mockResolvedValueOnce(merged);

    await buildUsecase(ENABLED).execute();

    // 상한을 돌려주지 않으면 머지 3건이 회차를 다 먹어 0건이 된다.
    expect(reviewUsecase.execute).toHaveBeenCalledTimes(3);
  });

  // 상한 밖 미검토 PR 은 정렬(updated DESC)상 갱신 전까지 계속 밖에 머물러 조용히 누락된다.
  // 페이지네이션 대신 그 조건이 실제로 닿았는지를 드러내 상한 상향 시점을 놓치지 않게 한다.
  it('조회가 상한까지 찼는데 전부 skip 되면 상한 밖 누락 가능성을 경고한다', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    github.listOpenPullRequestRefs.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => ({
        ...OPEN_PR,
        number: 300 + index,
      })),
    );
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'SUCCEEDED',
      startedAt: hoursAgo(1),
      dryRun: false,
      isDraft: false,
      errorCode: null,
    });

    await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('상한 상향을 검토'),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it('한 PR 의 실패가 다른 PR 을 막지 않는다', async () => {
    github.listOpenPullRequestRefs.mockResolvedValue([
      OPEN_PR,
      { ...OPEN_PR, number: 181 },
    ]);
    reviewUsecase.execute
      .mockRejectedValueOnce(new Error('모델 호출 실패'))
      .mockResolvedValueOnce(REVIEW_OUTCOME);

    const { results } = await buildUsecase(ENABLED).execute();

    expect(results).toHaveLength(1);
  });

  it('변경량이 GitHub diff 한도를 넘으면 리뷰하지 않고 원인을 변경량으로 밝힌다', async () => {
    github.getPullRequest.mockResolvedValue({
      number: 180,
      title: 'feat: 아주 큰 PR',
      body: '',
      repo: 'JSL107/personal_agents',
      url: OPEN_PR_URL,
      baseRef: 'main',
      baseSha: 'base-sha-main',
      headRef: 'feat/x',
      headSha: 'abc1234',
      authorLogin: 'JSL107',
      mergedAt: null,
      changedFiles: ['src/foo.service.ts'],
      changedFilesTruncated: false,
      changedFilesTotalCount: 127,
      additions: 27_778,
      deletions: 4_696,
      isDraft: false,
    });
    github.getPullRequestDiff.mockRejectedValue(
      new Error('PR #180 diff 조회 실패: too_large'),
    );

    const { results } = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(results).toEqual([]);
    // "diff 조회 실패" 만으로는 일시 장애인지 구조적 한계인지 안 갈린다 — 원장에 남는
    // 실패 사유가 변경량을 짚어야 다음 진단이 처음부터 시작되지 않는다.
    const recordedError = agentRunService.execute.mock.calls[0]?.[0];
    await expect(
      (recordedError as { run: (context: unknown) => Promise<unknown> }).run({
        agentRunId: 1,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('변경량 32474줄'),
      // 코드까지 실려야 다음 스윕이 문구가 아니라 코드로 영구 실패를 가른다. 평범한 Error 로
      // 던지면 원장 output 에 errorCode 가 빠져(AgentRunService.execute) 차단이 통째로 풀린다.
      errorCode: 'CODE_REVIEWER_DIFF_TOO_LARGE',
    });
  });

  it('상세와 diff 는 병렬로 조회한다 — 두 응답 사이의 push 창을 넓히지 않는다', async () => {
    let detailSettled = false;
    let diffStartedBeforeDetailSettled = false;
    github.getPullRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            detailSettled = true;
            resolve({
              number: 180,
              title: 'feat: 무언가',
              body: '',
              repo: 'JSL107/personal_agents',
              url: OPEN_PR_URL,
              baseRef: 'main',
              baseSha: 'base-sha-main',
              headRef: 'feat/x',
              headSha: 'abc1234',
              authorLogin: 'JSL107',
              mergedAt: null,
              changedFiles: ['src/foo.service.ts'],
              changedFilesTruncated: false,
              changedFilesTotalCount: 1,
              additions: 10,
              deletions: 2,
            } as never);
          }, 5);
        }),
    );
    github.getPullRequestDiff.mockImplementation(() => {
      diffStartedBeforeDetailSettled = !detailSettled;
      return Promise.resolve({ diff: 'diff', truncated: false, bytes: 4 });
    });

    await buildUsecase(ENABLED).execute();

    // 순차로 되돌아가면 diff 는 detail 이 끝난 뒤에 시작되어 이 값이 false 가 된다.
    expect(diffStartedBeforeDetailSettled).toBe(true);
  });

  it('조회 단계 실패도 AgentRun 원장에 남겨 재시도 판정이 볼 수 있게 한다', async () => {
    github.getPullRequestDiff.mockRejectedValue(
      new Error('PR #180 diff 조회 실패: too_large'),
    );

    await buildUsecase(ENABLED).execute();

    // 판정 질의(findLatestSweepReview / countUnsuccessfulSweepReviews)가 inputSnapshot 의
    // prRef 로 조회하므로, 그 키가 없으면 기록이 쌓여도 판정은 여전히 못 찾는다.
    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'PR_REVIEW_SWEEP',
        inputSnapshot: expect.objectContaining({
          prRef: 'JSL107/personal_agents#180',
        }),
      }),
    );
  });

  it('변경량 초과 스킵도 원장에 남는다 (다음 스윕이 무한 반복하지 않도록)', async () => {
    github.getPullRequest.mockResolvedValue({
      number: 180,
      title: 'feat: 경계값',
      body: '',
      repo: 'JSL107/personal_agents',
      url: OPEN_PR_URL,
      baseRef: 'main',
      baseSha: 'base-sha-main',
      headRef: 'feat/x',
      headSha: 'abc1234',
      authorLogin: 'JSL107',
      mergedAt: null,
      changedFiles: [],
      changedFilesTruncated: false,
      changedFilesTotalCount: 127,
      // 경계 바로 위 — 20,000 은 통과, 20,001 부터 컷.
      additions: 20_001,
      deletions: 0,
      isDraft: false,
    });
    github.getPullRequestDiff.mockRejectedValue(
      new Error('PR #180 diff 조회 실패: too_large'),
    );

    await buildUsecase(ENABLED).execute();

    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        inputSnapshot: expect.objectContaining({
          prRef: 'JSL107/personal_agents#180',
        }),
      }),
    );
  });

  it('리뷰 usecase 가 실패한 경우는 원장을 중복으로 남기지 않는다', async () => {
    // 리뷰 usecase 는 자기 AgentRun 을 열고 실패 시 스스로 FAILED 로 마감한다. 여기서 또
    // 기록하면 한 번의 실패가 2건이 되어 24시간 재시도 예산(3회)이 두 배 속도로 닳는다.
    reviewUsecase.execute.mockRejectedValue(new Error('모델 호출 실패'));

    await buildUsecase(ENABLED).execute();

    expect(agentRunService.execute).not.toHaveBeenCalled();
  });

  it('스윕 판정 조회 실패는 해당 PR 만 skip 하고 다른 PR 은 막지 않는다', async () => {
    github.listOpenPullRequestRefs.mockResolvedValue([
      OPEN_PR,
      { ...OPEN_PR, number: 181 },
    ]);
    agentRunService.findLatestSweepReview
      .mockRejectedValueOnce(new Error('DB 순간 오류'))
      .mockResolvedValueOnce(null);

    const { results } = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('findings 가 비어 있으면 게시 서비스를 호출하지 않는다', async () => {
    reviewUsecase.execute.mockResolvedValue({
      ...REVIEW_OUTCOME,
      result: { ...REVIEW_OUTCOME.result, findings: [] },
    });

    const { results } = await buildUsecase(ENABLED).execute();

    expect(publishService.publish).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  // 지적 0건이면 게시할 카드가 없어 PR 이 완전히 조용해진다 — "깨끗하다" 와 "리뷰가 돌긴 했나"
  // 가 구분되지 않으므로, 검토했다는 사실만 코멘트로 남는지 확인한다.
  describe('지적 0건 안내 코멘트', () => {
    // 다섯 목록을 모두 비운다 — findings 만 비우면 3배열에 지적이 남아 "지적 없음" 이
    // 성립하지 않는다(hasNoReviewFindings).
    const noFindings = (): void => {
      reviewUsecase.execute.mockResolvedValue({
        ...REVIEW_OUTCOME,
        result: {
          ...REVIEW_OUTCOME.result,
          summary: '요약 첫 줄\n요약 둘째 줄',
          mustFix: [],
          niceToHave: [],
          missingTests: [],
          reviewCommentDrafts: [],
          findings: [],
        },
      });
    };

    it('실게시 모드에서 findings 가 비면 PR 에 지적 없음 코멘트를 단다', async () => {
      noFindings();

      await buildUsecase({
        ...ENABLED,
        PR_REVIEW_INLINE_DRYRUN: 'false',
      }).execute();

      expect(github.addIssueComment).toHaveBeenCalledWith({
        repo: 'JSL107/personal_agents',
        number: 180,
        body: expect.stringContaining('지적 사항 없음'),
      });
      // 요약은 한 줄로 눌러 인용한다 — 줄바꿈이 남으면 인용 밖으로 새어 나간다.
      const [{ body }] = github.addIssueComment.mock.calls[0];
      expect(body).toContain('> 요약 첫 줄 요약 둘째 줄');
    });

    it('연습 모드에서는 코멘트를 달지 않는다', async () => {
      noFindings();

      await buildUsecase(ENABLED).execute();

      expect(github.addIssueComment).not.toHaveBeenCalled();
    });

    // 코멘트 실패가 바깥 catch 로 새도 반환값은 똑같이 [] 다 — 결과만으로는 구분되지 않으므로
    // "스윕 실패" 로그가 찍혔는지로 가른다.
    it('코멘트 게시가 실패해도 스윕 실패로 번지지 않는다', async () => {
      noFindings();
      github.addIssueComment.mockRejectedValue(new Error('403'));
      const errorLog = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const warnLog = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const { results } = await buildUsecase({
        ...ENABLED,
        PR_REVIEW_INLINE_DRYRUN: 'false',
      }).execute();

      expect(github.addIssueComment).toHaveBeenCalled();
      expect(results).toEqual([]);
      expect(errorLog).not.toHaveBeenCalled();
      expect(warnLog).toHaveBeenCalledWith(
        expect.stringContaining('지적 없음 코멘트 게시 실패'),
      );

      errorLog.mockRestore();
      warnLog.mockRestore();
    });

    // 파서는 findings 를 3배열에서만 파생시켜, 초안만 찬 응답이 findings 0 건으로 통과한다.
    // 그 리뷰에 "지적 없음" 을 달면 실제 리뷰 결과와 정반대가 된다 — 침묵하는 편이 안전하다.
    it('초안(reviewCommentDrafts)만 남은 응답에는 코멘트를 달지 않는다', async () => {
      reviewUsecase.execute.mockResolvedValue({
        ...REVIEW_OUTCOME,
        result: {
          ...REVIEW_OUTCOME.result,
          mustFix: [],
          niceToHave: [],
          missingTests: [],
          reviewCommentDrafts: [{ body: 'src/foo.ts:12 를 보세요' }],
          findings: [],
        },
      });

      const { results } = await buildUsecase({
        ...ENABLED,
        PR_REVIEW_INLINE_DRYRUN: 'false',
      }).execute();

      expect(github.addIssueComment).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('findings 가 있으면 안내 코멘트를 달지 않는다', async () => {
      await buildUsecase({
        ...ENABLED,
        PR_REVIEW_INLINE_DRYRUN: 'false',
      }).execute();

      expect(github.addIssueComment).not.toHaveBeenCalled();
      expect(publishService.publish).toHaveBeenCalled();
    });
  });

  it('DRYRUN 이 false 면 실게시 모드로 넘긴다', async () => {
    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_DRYRUN: 'false',
    }).execute();

    expect(publishService.publish).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
  });

  it('PR_REVIEW_INLINE_MAX 가 빈 문자열이면 기본값(4)을 쓴다', async () => {
    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_MAX: '',
    }).execute();

    expect(publishService.publish).toHaveBeenCalledWith(
      expect.objectContaining({ max: 4 }),
    );
  });

  it('PR_REVIEW_INLINE_MAX 가 공백 문자열이면 기본값(4)을 쓴다', async () => {
    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_MAX: '   ',
    }).execute();

    expect(publishService.publish).toHaveBeenCalledWith(
      expect.objectContaining({ max: 4 }),
    );
  });
  // 쿼터는 PR 1건의 문제가 아니라 회차 전체가 못 도는 상황이다. 삼키면 남은 PR 에
  // 같은 실패를 반복하고, 무엇보다 호출부가 "볼 게 없었다" 와 구분하지 못해 Slack 이
  // 조용해진다(실측 2026-08-07~08, 26 회차).
  it('쿼터가 소진되면 회차를 끊고 그 사실을 올린다', async () => {
    // PR 은 회차 상한(NEW_REVIEW_LIMIT_PER_SWEEP=3)만큼 둔다. 2 개만 두면 조기 종료를
    // 지워도 호출이 2 회로 끝나 이 단언이 그대로 통과해, 중단 동작을 검증하지 못한다.
    github.listOpenPullRequestRefs.mockResolvedValue([
      OPEN_PR,
      { ...OPEN_PR, number: 181 },
      { ...OPEN_PR, number: 182 },
    ]);
    reviewUsecase.execute
      .mockResolvedValueOnce(REVIEW_OUTCOME)
      .mockRejectedValueOnce(new CodexQuotaExceededException('Aug 8th 7:00 PM'))
      .mockResolvedValueOnce(REVIEW_OUTCOME);

    const { results, quotaStopped } = await buildUsecase(ENABLED).execute();

    expect(quotaStopped).toBe(true);
    // 끊기 전에 끝난 PR 의 결과는 버리지 않는다 — 이미 카드가 나갔을 수 있다.
    expect(results).toHaveLength(1);
    expect(results[0].prRef).toBe('JSL107/personal_agents#180');
    // 세 번째 PR 은 시도하지 않는다 — 끊지 않으면 여기서 3 회가 된다.
    expect(reviewUsecase.execute).toHaveBeenCalledTimes(2);
  });

  it('쿼터가 아닌 실패는 종전대로 삼키고 다음 PR 을 계속한다', async () => {
    github.listOpenPullRequestRefs.mockResolvedValue([
      OPEN_PR,
      { ...OPEN_PR, number: 181 },
    ]);
    reviewUsecase.execute
      .mockRejectedValueOnce(new Error('모델 응답 파싱 실패'))
      .mockResolvedValueOnce(REVIEW_OUTCOME);

    const { results, quotaStopped } = await buildUsecase(ENABLED).execute();

    expect(quotaStopped).toBe(false);
    expect(results).toHaveLength(1);
    expect(reviewUsecase.execute).toHaveBeenCalledTimes(2);
  });

  // reviewAndPublish 는 쿼터만 올려보내지만, 계약이 깨져 다른 예외가 새면 그것을
  // '쿼터 소진' 으로 보고해선 안 된다 — 원인이 아닌 곳을 보게 만든다.
  it('쿼터가 아닌 예외가 새어나오면 쿼터로 단정하지 않고 올린다', async () => {
    const spy = jest
      .spyOn(
        SweepPrReviewsUsecase.prototype as unknown as {
          reviewAndPublish: () => Promise<never>;
        },
        'reviewAndPublish',
      )
      .mockRejectedValue(new Error('예상 못 한 실패'));

    try {
      await expect(buildUsecase(ENABLED).execute()).rejects.toThrow(
        '예상 못 한 실패',
      );
    } finally {
      // 프로토타입에 건 스파이는 파일 전체에 남는다 — 이 테스트 안에서 되돌린다.
      spy.mockRestore();
    }
  });
});
