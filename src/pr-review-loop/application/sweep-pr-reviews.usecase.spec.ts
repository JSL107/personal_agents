import { ConfigService } from '@nestjs/config';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { PublishFindingsService } from './publish-findings.service';
import { SweepPrReviewsUsecase } from './sweep-pr-reviews.usecase';

const OPEN_PR = {
  number: 180,
  title: 'feat: 무언가',
  body: '',
  repo: 'JSL107/personal_agents',
  url: 'https://github.com/JSL107/personal_agents/pull/180',
  state: 'open' as const,
  mergedAt: null,
  updatedAt: '2026-07-31T00:00:00Z',
  additions: 10,
  deletions: 2,
  changedFilesCount: 1,
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
      'listAuthorOpenPullRequests' | 'getPullRequest' | 'getPullRequestDiff'
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
      listAuthorOpenPullRequests: jest.fn().mockResolvedValue([OPEN_PR]),
      getPullRequest: jest.fn().mockResolvedValue({
        number: 180,
        title: 'feat: 무언가',
        body: '',
        repo: 'JSL107/personal_agents',
        url: OPEN_PR.url,
        baseRef: 'main',
        headRef: 'feat/x',
        headSha: 'abc1234',
        authorLogin: 'JSL107',
        changedFiles: ['src/foo.service.ts'],
        changedFilesTruncated: false,
        changedFilesTotalCount: 1,
        additions: 10,
        deletions: 2,
      }),
      getPullRequestDiff: jest
        .fn()
        .mockResolvedValue({ diff: 'diff', truncated: false, bytes: 4 }),
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
    const results = await buildUsecase({
      ...ENABLED,
      PR_REVIEW_LOOP_ENABLED: 'false',
    }).execute();

    expect(results).toEqual([]);
    expect(github.listAuthorOpenPullRequests).not.toHaveBeenCalled();
  });

  it('owner login 이 없으면 아무것도 하지 않는다', async () => {
    const results = await buildUsecase({
      ...ENABLED,
      GITHUB_WEBHOOK_OWNER_LOGIN: undefined,
    }).execute();

    expect(results).toEqual([]);
  });

  it('Slack owner id 가 없으면 아무것도 하지 않는다', async () => {
    const results = await buildUsecase({
      ...ENABLED,
      AUTOPILOT_OWNER_SLACK_USER_ID: undefined,
    }).execute();

    expect(results).toEqual([]);
    expect(github.listAuthorOpenPullRequests).not.toHaveBeenCalled();
  });

  it('allowlist 가 비어 있으면 스윕 자체를 하지 않는다', async () => {
    const results = await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_REPOS: undefined,
    }).execute();

    expect(results).toEqual([]);
    expect(github.listAuthorOpenPullRequests).not.toHaveBeenCalled();
  });

  it('allowlist 레포의 열린 PR 을 리뷰하고 게시 서비스에 넘긴다 (레코드 없음 → 리뷰함)', async () => {
    const results = await buildUsecase(ENABLED).execute();

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
    });

    const results = await buildUsecase(ENABLED).execute();

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
    });

    await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
  });

  it('실게시 모드에서도 SUCCEEDED 판정은 동일하게 skip 된다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'SUCCEEDED',
      startedAt: hoursAgo(1),
      dryRun: false,
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
    });

    const results = await buildUsecase({
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
    });

    await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
  });

  it('직전이 FAILED + 쿨다운(10분) 안이면 재리뷰하지 않는다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'FAILED',
      startedAt: minutesAgo(5),
      dryRun: false,
    });

    const results = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('직전이 FAILED + 쿨다운(10분) 지나면 재리뷰한다 — 일시적 codex 실패가 PR 수명 동안 제외되지 않는다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'FAILED',
      startedAt: minutesAgo(15),
      dryRun: false,
    });

    const results = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('직전이 IN_PROGRESS + 쿨다운(10분) 안이면 재리뷰하지 않는다 — 진행 중 중복 리뷰 방지', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'IN_PROGRESS',
      startedAt: minutesAgo(5),
      dryRun: false,
    });

    const results = await buildUsecase(ENABLED).execute();

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
    });
    agentRunService.countUnsuccessfulSweepReviews.mockResolvedValue(3);

    const results = await buildUsecase(ENABLED).execute();

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
    });
    agentRunService.countUnsuccessfulSweepReviews.mockResolvedValue(2);

    const results = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('재시도 예산 조회가 실패하면 보수적으로 재리뷰하지 않는다', async () => {
    agentRunService.findLatestSweepReview.mockResolvedValue({
      status: 'FAILED',
      startedAt: minutesAgo(15),
      dryRun: false,
    });
    agentRunService.countUnsuccessfulSweepReviews.mockRejectedValue(
      new Error('DB 순간 오류'),
    );

    const results = await buildUsecase(ENABLED).execute();

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
    github.listAuthorOpenPullRequests.mockResolvedValue(many);

    await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(3);
  });

  it('레포 간 상한(3건)은 합산으로 적용된다', async () => {
    const buildPrsForRepo = (repo: string) =>
      Array.from({ length: 3 }, (_, index) => ({
        ...OPEN_PR,
        repo,
        number: 100 + index,
        url: `https://github.com/${repo}/pull/${100 + index}`,
      }));
    github.listAuthorOpenPullRequests.mockImplementation((options) =>
      Promise.resolve(buildPrsForRepo(options.repo as string)),
    );

    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_REPOS: 'org/repo-a,org/repo-b,org/repo-c',
    }).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(3);
  });

  it('한 PR 의 실패가 다른 PR 을 막지 않는다', async () => {
    github.listAuthorOpenPullRequests.mockResolvedValue([
      OPEN_PR,
      { ...OPEN_PR, number: 181 },
    ]);
    reviewUsecase.execute
      .mockRejectedValueOnce(new Error('모델 호출 실패'))
      .mockResolvedValueOnce(REVIEW_OUTCOME);

    const results = await buildUsecase(ENABLED).execute();

    expect(results).toHaveLength(1);
  });

  it('변경량이 GitHub diff 한도를 넘으면 diff 를 요청하지 않는다', async () => {
    github.getPullRequest.mockResolvedValue({
      number: 180,
      title: 'feat: 아주 큰 PR',
      body: '',
      repo: 'JSL107/personal_agents',
      url: OPEN_PR.url,
      baseRef: 'main',
      headRef: 'feat/x',
      headSha: 'abc1234',
      authorLogin: 'JSL107',
      changedFiles: ['src/foo.service.ts'],
      changedFilesTruncated: false,
      changedFilesTotalCount: 127,
      additions: 27_778,
      deletions: 4_696,
    });

    const results = await buildUsecase(ENABLED).execute();

    // 406(too_large)이 될 요청을 아예 보내지 않는다 — 재시도해도 PR 이 작아지지 않는다.
    expect(github.getPullRequestDiff).not.toHaveBeenCalled();
    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(results).toEqual([]);
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
      url: OPEN_PR.url,
      baseRef: 'main',
      headRef: 'feat/x',
      headSha: 'abc1234',
      authorLogin: 'JSL107',
      changedFiles: [],
      changedFilesTruncated: false,
      changedFilesTotalCount: 127,
      // 경계 바로 위 — 20,000 은 통과, 20,001 부터 컷.
      additions: 20_001,
      deletions: 0,
    });

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
    github.listAuthorOpenPullRequests.mockResolvedValue([
      OPEN_PR,
      { ...OPEN_PR, number: 181 },
    ]);
    agentRunService.findLatestSweepReview
      .mockRejectedValueOnce(new Error('DB 순간 오류'))
      .mockResolvedValueOnce(null);

    const results = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('findings 가 비어 있으면 게시 서비스를 호출하지 않는다', async () => {
    reviewUsecase.execute.mockResolvedValue({
      ...REVIEW_OUTCOME,
      result: { ...REVIEW_OUTCOME.result, findings: [] },
    });

    const results = await buildUsecase(ENABLED).execute();

    expect(publishService.publish).not.toHaveBeenCalled();
    expect(results).toEqual([]);
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
});
