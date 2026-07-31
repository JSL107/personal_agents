import { ConfigService } from '@nestjs/config';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { PrReviewFindingRepositoryPort } from '../domain/port/pr-review-finding.repository.port';
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
  let repository: jest.Mocked<PrReviewFindingRepositoryPort>;
  let publishService: jest.Mocked<Pick<PublishFindingsService, 'publish'>>;

  const buildUsecase = (values: Record<string, string | undefined>) =>
    new SweepPrReviewsUsecase(
      github as unknown as GithubClientPort,
      reviewUsecase as unknown as ReviewPullRequestUsecase,
      repository,
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
    repository = {
      createIfAbsent: jest.fn(),
      hasAnyForPullRequest: jest.fn().mockResolvedValue(false),
      markPosted: jest.fn(),
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

  it('allowlist 레포의 열린 PR 을 리뷰하고 게시 서비스에 넘긴다', async () => {
    const results = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        prRef: 'JSL107/personal_agents#180',
        triggerType: 'PR_REVIEW_SWEEP',
      }),
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

  it('이미 카드가 있는 PR 은 다시 리뷰하지 않는다 — PR 당 리뷰 1회', async () => {
    repository.hasAnyForPullRequest.mockResolvedValue(true);

    const results = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('스윕 1회의 신규 리뷰는 상한(5건)까지만', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...OPEN_PR,
      number: 200 + index,
    }));
    github.listAuthorOpenPullRequests.mockResolvedValue(many);

    await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(5);
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
});
