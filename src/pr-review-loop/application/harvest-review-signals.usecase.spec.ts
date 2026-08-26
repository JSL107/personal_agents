import { ConfigService } from '@nestjs/config';

import { JudgeFindingResolutionUsecase } from '../../agent/review-reply-judge/application/judge-finding-resolution.usecase';
import { JudgeReviewReplyUsecase } from '../../agent/review-reply-judge/application/judge-review-reply.usecase';
import {
  GithubClientPort,
  ReviewThread,
} from '../../github/domain/port/github-client.port';
import { CodexQuotaExceededException } from '../../model-router/infrastructure/codex-cli.provider';
import { PrReviewFindingRepositoryPort } from '../domain/port/pr-review-finding.repository.port';
import { PrReviewFindingRecord } from '../domain/pr-review-finding.type';
import { HarvestReviewSignalsUsecase } from './harvest-review-signals.usecase';

const card = (
  overrides: Partial<PrReviewFindingRecord> = {},
): PrReviewFindingRecord => ({
  id: 1,
  agentRunId: 7,
  repo: 'JSL107/personal_agents',
  pullNumber: 180,
  headSha: 'abc1234',
  category: 'RELIABILITY',
  severity: 'MUST_FIX',
  filePath: 'src/foo.service.ts',
  line: 42,
  body: '트랜잭션 밖에서 저장한다',
  fingerprint: 'fp-1',
  status: 'OPEN',
  postMode: 'INLINE',
  githubCommentId: '555',
  githubThreadNodeId: 'PRRC_wrong_comment_node',
  createdAt: new Date('2026-07-31T00:00:00Z'),
  ...overrides,
});

const reviewThread = ({
  databaseId = 555,
  reactions = [],
  replies = [],
  isResolved = false,
}: {
  databaseId?: number;
  reactions?: ReviewThread['comments'][number]['reactions'];
  replies?: ReviewThread['comments'];
  isResolved?: boolean;
} = {}): ReviewThread => ({
  threadId: `PRRT_${databaseId}`,
  isResolved,
  comments: [
    {
      databaseId,
      authorLogin: 'idaeri-bot',
      body: '리뷰 본문',
      createdAt: '2026-07-31T00:00:00Z',
      reactions,
    },
    ...replies,
  ],
});

const buildDependencies = ({
  enabled = true,
  ownerLogin = 'owner',
}: {
  enabled?: boolean;
  ownerLogin?: string | undefined;
} = {}) => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'PR_REVIEW_HARVEST_ENABLED') {
        return enabled ? 'true' : 'false';
      }
      if (key === 'GITHUB_WEBHOOK_OWNER_LOGIN') {
        return ownerLogin;
      }
      return undefined;
    }),
  };
  const github = {
    listReviewThreads: jest.fn(),
    resolveReviewThread: jest.fn().mockResolvedValue(undefined),
    getPullRequest: jest.fn().mockResolvedValue({ headSha: 'abc1234' }),
    compareCommits: jest.fn().mockResolvedValue({
      diff: '',
      truncated: false,
      bytes: 0,
    }),
  };
  const repository = {
    createIfAbsent: jest.fn(),
    hasAnyForPullRequest: jest.fn(),
    markPosted: jest.fn(),
    findOpenPostedCards: jest.fn(),
    markDecided: jest.fn().mockResolvedValue(undefined),
    markThreadResolved: jest.fn().mockResolvedValue(undefined),
    countOpenPostedByPullRequest: jest.fn().mockResolvedValue([]),
    countAdoptionByCategory: jest.fn().mockResolvedValue([]),
    findRejectionsForConventions: jest.fn().mockResolvedValue([]),
  } satisfies jest.Mocked<PrReviewFindingRepositoryPort>;
  const judge = { execute: jest.fn().mockResolvedValue([]) };
  const resolutionJudge = { execute: jest.fn().mockResolvedValue([]) };
  const usecase = new HarvestReviewSignalsUsecase(
    config as unknown as ConfigService,
    github as unknown as GithubClientPort,
    repository,
    judge as unknown as JudgeReviewReplyUsecase,
    resolutionJudge as unknown as JudgeFindingResolutionUsecase,
  );
  return { usecase, github, repository, judge, resolutionJudge };
};

describe('HarvestReviewSignalsUsecase', () => {
  it('수확이 비활성이면 저장소와 GitHub를 호출하지 않는다', async () => {
    const { usecase, github, repository } = buildDependencies({
      enabled: false,
    });

    await expect(usecase.execute()).resolves.toEqual({
      acked: 0,
      rejected: 0,
      fixed: 0,
      stale: 0,
      resolved: 0,
      judged: 0,
      skipped: 0,
      adoption: [],
    });
    expect(repository.findOpenPostedCards).not.toHaveBeenCalled();
    expect(github.listReviewThreads).not.toHaveBeenCalled();
  });

  it('ACKED/REJECTED/STALE을 전이하고 PRRC 대신 조회한 PRRT를 저장한다', async () => {
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([
      card(),
      card({ id: 2, githubCommentId: '556', fingerprint: 'fp-2' }),
      card({ id: 3, githubCommentId: '557', fingerprint: 'fp-3' }),
    ]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'MERGED',
      truncated: false,
      threads: [
        reviewThread({
          reactions: [
            {
              content: 'THUMBS_UP',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        }),
        reviewThread({
          databaseId: 556,
          reactions: [
            {
              content: 'THUMBS_DOWN',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        }),
        reviewThread({ databaseId: 557 }),
      ],
    });

    const outcome = await usecase.execute();

    expect(outcome).toMatchObject({ acked: 1, rejected: 1, stale: 1 });
    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 1,
      status: 'ACKED',
      rejectReason: null,
      githubThreadNodeId: 'PRRT_555',
    });
    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 2,
      status: 'REJECTED',
      rejectReason: null,
      githubThreadNodeId: 'PRRT_556',
    });
    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 3,
      status: 'STALE',
      rejectReason: null,
      githubThreadNodeId: 'PRRT_557',
    });
    expect(github.resolveReviewThread).toHaveBeenCalledWith('PRRT_555');
    expect(github.resolveReviewThread).toHaveBeenCalledWith('PRRT_556');
    expect(github.resolveReviewThread).not.toHaveBeenCalledWith('PRRT_557');
  });

  it('owner와 다른 PR 작성자의 THUMBS_UP도 ACKED로 반영한다', async () => {
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: 'pr-author',
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({
          reactions: [
            {
              content: 'THUMBS_UP',
              userLogin: 'pr-author',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        }),
      ],
    });

    const outcome = await usecase.execute();

    expect(outcome).toMatchObject({ acked: 1 });
    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 1,
      status: 'ACKED',
      rejectReason: null,
      githubThreadNodeId: 'PRRT_555',
    });
  });

  it('잘린 GraphQL 결과에서 코멘트를 못 찾으면 종료 PR도 STALE 확정을 보류한다', async () => {
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'MERGED',
      truncated: true,
      threads: [],
    });

    const outcome = await usecase.execute();

    expect(outcome).toMatchObject({ stale: 0, skipped: 1 });
    expect(repository.markDecided).not.toHaveBeenCalled();
    expect(repository.markThreadResolved).not.toHaveBeenCalled();
  });

  it('THUMBS_DOWN과 owner 답글을 기각 이유로 보존한다', async () => {
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({
          reactions: [
            {
              content: 'THUMBS_DOWN',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
          replies: [
            {
              databaseId: 556,
              authorLogin: 'owner',
              body: '의도된 동작이라 변경하지 않습니다',
              createdAt: '2026-07-31T02:00:00Z',
              reactions: [],
            },
          ],
        }),
      ],
    });

    await usecase.execute();

    expect(judge.execute).not.toHaveBeenCalled();
    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 1,
      status: 'REJECTED',
      rejectReason: '의도된 동작이라 변경하지 않습니다',
      githubThreadNodeId: 'PRRT_555',
    });
  });

  it('이미 resolve된 스레드도 owner 기각 신호를 먼저 반영한다', async () => {
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({
          isResolved: true,
          reactions: [
            {
              content: 'THUMBS_DOWN',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        }),
      ],
    });

    const outcome = await usecase.execute();

    expect(outcome).toMatchObject({ rejected: 1, resolved: 1 });
    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 1,
      status: 'REJECTED',
      rejectReason: null,
      githubThreadNodeId: 'PRRT_555',
    });
    expect(github.resolveReviewThread).not.toHaveBeenCalled();
  });

  describe('후속 커밋 해소 판정 (FIXED)', () => {
    const CHANGED_DIFF = `diff --git a/src/foo.service.ts b/src/foo.service.ts
--- a/src/foo.service.ts
+++ b/src/foo.service.ts
@@ -40,2 +42,3 @@
-  await save();
+  await this.prisma.$transaction(async (tx) => save(tx));
`;

    const buildNoReactionThread = () => ({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN' as const,
      truncated: false,
      threads: [reviewThread()],
    });

    it('지적한 줄이 안 바뀌었으면 LLM 을 부르지 않고 미결로 둔다', async () => {
      // 1차 결정론 필터. 변경과 안 겹치는 카드까지 물으면 PR 마다 쓸데없이 비싸진다.
      const { usecase, github, repository, resolutionJudge } =
        buildDependencies();
      repository.findOpenPostedCards.mockResolvedValue([card()]);
      github.listReviewThreads.mockResolvedValue(buildNoReactionThread());
      github.getPullRequest.mockResolvedValue({ headSha: 'def5678' });
      github.compareCommits.mockResolvedValue({
        diff: `diff --git a/src/other.ts b/src/other.ts
--- a/src/other.ts
+++ b/src/other.ts
@@ -1 +1,2 @@
+const x = 1;
`,
        truncated: false,
        bytes: 10,
      });

      const outcome = await usecase.execute();

      expect(resolutionJudge.execute).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ fixed: 0, skipped: 1 });
      expect(repository.markDecided).not.toHaveBeenCalled();
    });

    it('카드 게시 후 새 커밋이 없으면 비교조차 하지 않는다', async () => {
      const { usecase, github, repository, resolutionJudge } =
        buildDependencies();
      repository.findOpenPostedCards.mockResolvedValue([card()]);
      github.listReviewThreads.mockResolvedValue(buildNoReactionThread());
      // 카드 fixture 의 headSha 와 같다.
      github.getPullRequest.mockResolvedValue({ headSha: 'abc1234' });

      const outcome = await usecase.execute();

      expect(github.compareCommits).not.toHaveBeenCalled();
      expect(resolutionJudge.execute).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ fixed: 0, skipped: 1 });
    });

    it('겹치고 FIXED 판정이면 확정하고 스레드를 닫는다', async () => {
      const { usecase, github, repository, resolutionJudge } =
        buildDependencies();
      repository.findOpenPostedCards.mockResolvedValue([card({ line: 42 })]);
      github.listReviewThreads.mockResolvedValue(buildNoReactionThread());
      github.getPullRequest.mockResolvedValue({ headSha: 'def5678' });
      github.compareCommits.mockResolvedValue({
        diff: CHANGED_DIFF,
        truncated: false,
        bytes: 100,
      });
      resolutionJudge.execute.mockResolvedValue([
        { id: 1, verdict: 'FIXED', reason: '트랜잭션으로 감쌈' },
      ]);

      const outcome = await usecase.execute();

      expect(github.compareCommits).toHaveBeenCalledWith({
        repo: 'JSL107/personal_agents',
        baseSha: 'abc1234',
        headSha: 'def5678',
      });
      expect(outcome).toMatchObject({ fixed: 1, judged: 1, resolved: 1 });
      expect(repository.markDecided).toHaveBeenCalledWith({
        id: 1,
        status: 'FIXED',
        rejectReason: null,
        githubThreadNodeId: 'PRRT_555',
      });
    });

    it('UNCLEAR 면 OPEN 을 유지한다 — 억지 판정보다 미결이 안전하다', async () => {
      const { usecase, github, repository, resolutionJudge } =
        buildDependencies();
      repository.findOpenPostedCards.mockResolvedValue([card({ line: 42 })]);
      github.listReviewThreads.mockResolvedValue(buildNoReactionThread());
      github.getPullRequest.mockResolvedValue({ headSha: 'def5678' });
      github.compareCommits.mockResolvedValue({
        diff: CHANGED_DIFF,
        truncated: false,
        bytes: 100,
      });
      resolutionJudge.execute.mockResolvedValue([
        { id: 1, verdict: 'UNCLEAR', reason: '' },
      ]);

      const outcome = await usecase.execute();

      expect(outcome).toMatchObject({ fixed: 0, skipped: 1 });
      expect(repository.markDecided).not.toHaveBeenCalled();
    });

    it('판정 호출이 실패해도 카드를 확정하지 않고 다음 PR 을 계속한다', async () => {
      const { usecase, github, repository, resolutionJudge } =
        buildDependencies();
      repository.findOpenPostedCards.mockResolvedValue([card({ line: 42 })]);
      github.listReviewThreads.mockResolvedValue(buildNoReactionThread());
      github.getPullRequest.mockResolvedValue({ headSha: 'def5678' });
      github.compareCommits.mockResolvedValue({
        diff: CHANGED_DIFF,
        truncated: false,
        bytes: 100,
      });
      resolutionJudge.execute.mockRejectedValue(new Error('quota'));

      const outcome = await usecase.execute();

      expect(outcome).toMatchObject({ fixed: 0, skipped: 1 });
      expect(repository.markDecided).not.toHaveBeenCalled();
    });

    it('같은 head 는 두 번 묻지 않는다 — 5분 스윕이 같은 판정을 반복하면 쿼터가 마른다', async () => {
      const { usecase, github, repository, resolutionJudge } =
        buildDependencies();
      repository.findOpenPostedCards.mockResolvedValue([card({ line: 42 })]);
      github.listReviewThreads.mockResolvedValue(buildNoReactionThread());
      github.getPullRequest.mockResolvedValue({ headSha: 'def5678' });
      github.compareCommits.mockResolvedValue({
        diff: CHANGED_DIFF,
        truncated: false,
        bytes: 100,
      });
      // 결론이 안 나 카드가 OPEN 으로 남는 경우가 문제다.
      resolutionJudge.execute.mockResolvedValue([
        { id: 1, verdict: 'UNCLEAR', reason: '' },
      ]);

      await usecase.execute();
      await usecase.execute();

      expect(resolutionJudge.execute).toHaveBeenCalledTimes(1);
    });

    it('비교 diff 가 잘렸으면 판정을 보류한다 — 일부 증거로 카드를 닫지 않는다', async () => {
      const { usecase, github, repository, resolutionJudge } =
        buildDependencies();
      repository.findOpenPostedCards.mockResolvedValue([card({ line: 42 })]);
      github.listReviewThreads.mockResolvedValue(buildNoReactionThread());
      github.getPullRequest.mockResolvedValue({ headSha: 'def5678' });
      github.compareCommits.mockResolvedValue({
        diff: CHANGED_DIFF,
        truncated: true,
        bytes: 999999,
      });

      const outcome = await usecase.execute();

      expect(resolutionJudge.execute).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ fixed: 0, skipped: 1 });
      expect(repository.markDecided).not.toHaveBeenCalled();
    });

    it('쿼터가 소진되면 남은 PR 을 계속 시도하지 않고 회차를 끊는다', async () => {
      const { usecase, github, repository, resolutionJudge } =
        buildDependencies();
      repository.findOpenPostedCards.mockResolvedValue([
        card({ line: 42 }),
        card({
          id: 2,
          line: 42,
          pullNumber: 181,
          githubCommentId: '556',
          fingerprint: 'fp-2',
        }),
      ]);
      github.listReviewThreads.mockResolvedValue(buildNoReactionThread());
      github.getPullRequest.mockResolvedValue({ headSha: 'def5678' });
      github.compareCommits.mockResolvedValue({
        diff: CHANGED_DIFF,
        truncated: false,
        bytes: 100,
      });
      resolutionJudge.execute.mockRejectedValue(
        new CodexQuotaExceededException('내일 09:00'),
      );

      await usecase.execute();

      // 첫 PR 에서 끊는다. 두 번째 PR 까지 부르면 쿼터만 더 태운다.
      expect(resolutionJudge.execute).toHaveBeenCalledTimes(1);
    });

    it('PR 이 닫혀 있으면 해소 판정을 하지 않는다', async () => {
      const { usecase, github, repository, resolutionJudge } =
        buildDependencies();
      repository.findOpenPostedCards.mockResolvedValue([card({ line: 42 })]);
      github.listReviewThreads.mockResolvedValue({
        pullRequestAuthorLogin: null,
        pullRequestState: 'MERGED',
        truncated: false,
        threads: [reviewThread()],
      });

      await usecase.execute();

      expect(resolutionJudge.execute).not.toHaveBeenCalled();
      expect(github.compareCommits).not.toHaveBeenCalled();
    });
  });

  it('PR이 종료된 채 스레드만 resolve된 카드는 STALE로 남긴다', async () => {
    // OPEN 인 채 resolvedAt 만 채우면 다음 회차 조회(status='OPEN' AND resolvedAt IS NULL)
    // 에서 빠져 "아직 안 봄" 과 "결론 없이 끝남" 이 영원히 구분되지 않는다.
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'MERGED',
      truncated: false,
      threads: [reviewThread({ isResolved: true })],
    });

    const outcome = await usecase.execute();

    expect(outcome).toMatchObject({ stale: 1, resolved: 1 });
    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 1,
      status: 'STALE',
      rejectReason: null,
      githubThreadNodeId: 'PRRT_555',
      resolveThread: true,
    });
  });

  it('STALE 확정은 단일 쓰기다 — 상태와 닫힘을 나눠 쓰지 않는다', async () => {
    // 나눠 쓰면 첫 쓰기 직후 실패했을 때 status 가 STALE 이라 다음 회차 조회(OPEN 만)
    // 에서 빠지고, 남은 갱신을 재시도할 길이 없어 부분 상태가 고착된다.
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'MERGED',
      truncated: false,
      threads: [reviewThread({ isResolved: true })],
    });

    await usecase.execute();

    expect(repository.markDecided).toHaveBeenCalledTimes(1);
    expect(repository.markThreadResolved).not.toHaveBeenCalled();
  });

  it('열린 PR에서 스레드만 resolve되면 상태를 바꾸지 않고 닫힘만 기록한다', async () => {
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [reviewThread({ isResolved: true })],
    });

    const outcome = await usecase.execute();

    expect(outcome).toMatchObject({ stale: 0, resolved: 1 });
    expect(repository.markDecided).not.toHaveBeenCalled();
    expect(repository.markThreadResolved).toHaveBeenCalledWith(1);
  });

  it('owner 답글은 PR 단위 1회 배치 판정하고 기각 이유를 저장한다', async () => {
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([
      card(),
      card({ id: 2, githubCommentId: '556', fingerprint: 'fp-2' }),
    ]);
    const reply = (databaseId: number, body: string) => ({
      databaseId,
      authorLogin: 'owner',
      body,
      createdAt: '2026-07-31T01:00:00Z',
      reactions: [],
    });
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({ replies: [reply(600, '수정했습니다')] }),
        reviewThread({
          databaseId: 556,
          replies: [reply(601, '이 지적은 틀렸습니다')],
        }),
      ],
    });
    judge.execute.mockResolvedValue([
      { id: 1, verdict: 'ACCEPTED', reason: '수정함' },
      { id: 2, verdict: 'REJECTED', reason: '의도된 동작' },
    ]);

    const outcome = await usecase.execute();

    expect(judge.execute).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ acked: 1, rejected: 1, judged: 2 });
    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 2,
      status: 'REJECTED',
      rejectReason: '의도된 동작',
      githubThreadNodeId: 'PRRT_556',
    });
  });

  it('UNCLEAR 판정은 judged 가 아니라 skipped 로만 센다', async () => {
    // 판정기는 입력 전건에 결과를 돌려주므로(실패분은 UNCLEAR) 판정 결과 개수를
    // 그대로 judged 에 더하면 시도 건수가 되고, UNCLEAR 가 skipped 로도 세어져
    // 같은 카드가 두 번 집계된다.
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([
      card(),
      card({ id: 2, githubCommentId: '556', fingerprint: 'fp-2' }),
    ]);
    const reply = (databaseId: number, body: string) => ({
      databaseId,
      authorLogin: 'owner',
      body,
      createdAt: '2026-07-31T01:00:00Z',
      reactions: [],
    });
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({ replies: [reply(600, '수정했습니다')] }),
        reviewThread({
          databaseId: 556,
          replies: [reply(601, '이건 무슨 뜻인가요?')],
        }),
      ],
    });
    judge.execute.mockResolvedValue([
      { id: 1, verdict: 'ACCEPTED', reason: '수정함' },
      { id: 2, verdict: 'UNCLEAR', reason: '' },
    ]);

    const outcome = await usecase.execute();

    expect(outcome).toMatchObject({ acked: 1, judged: 1, skipped: 1 });
    expect(repository.markDecided).toHaveBeenCalledTimes(1);
  });

  it('resolve 실패해도 결정 상태를 유지하고 markThreadResolved만 생략한다', async () => {
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({
          reactions: [
            {
              content: 'THUMBS_DOWN',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        }),
      ],
    });
    github.resolveReviewThread.mockRejectedValue(new Error('forbidden'));

    const outcome = await usecase.execute();

    expect(outcome.rejected).toBe(1);
    expect(repository.markDecided).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REJECTED' }),
    );
    expect(repository.markThreadResolved).not.toHaveBeenCalled();
  });

  it('LLM 실패 시 답글 판정만 건너뛰고 리액션 신호는 반영한다', async () => {
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([
      card(),
      card({ id: 2, githubCommentId: '556', fingerprint: 'fp-2' }),
    ]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({
          reactions: [
            {
              content: 'THUMBS_UP',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        }),
        reviewThread({
          databaseId: 556,
          replies: [
            {
              databaseId: 600,
              authorLogin: 'owner',
              body: '수정했습니다',
              createdAt: '2026-07-31T01:00:00Z',
              reactions: [],
            },
          ],
        }),
      ],
    });
    judge.execute.mockRejectedValue(new Error('quota'));

    const outcome = await usecase.execute();

    expect(outcome).toMatchObject({ acked: 1, judged: 0, skipped: 1 });
    expect(repository.markDecided).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, status: 'ACKED' }),
    );
    expect(repository.markDecided).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 }),
    );
  });

  it('카드 상태가 바뀌면 누적 채택률을 함께 낸다', async () => {
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    repository.countAdoptionByCategory.mockResolvedValue([
      { category: 'TEST', status: 'ACKED', count: 12 },
      { category: 'TEST', status: 'REJECTED', count: 3 },
    ]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({
          reactions: [
            {
              content: 'THUMBS_UP',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        }),
      ],
    });

    const outcome = await usecase.execute();

    expect(outcome.acked).toBe(1);
    // 12/15 = 80%
    expect(outcome.adoption).toEqual([
      {
        category: 'TEST',
        adopted: 12,
        rejected: 3,
        total: 15,
        ratePercent: 80,
      },
    ]);
  });

  // 이 회차에 반응이 없어도 누적 채택률은 실어야 한다. 이 그룹의 Slack 발송은 하루 1회뿐이라
  // (autopilot.orchestrator buildGuardKey), 반응이 있던 회차가 그날 첫 발송이 아니면 그대로
  // 차단된다 — 조회를 반응 있는 회차로 아끼면 그 값이 영영 안 나온다.
  it('반응이 없는 회차에도 누적 채택률을 낸다', async () => {
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    repository.countAdoptionByCategory.mockResolvedValue([
      { category: 'TEST', status: 'ACKED', count: 12 },
      { category: 'TEST', status: 'REJECTED', count: 3 },
    ]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [reviewThread()],
    });

    const outcome = await usecase.execute();

    expect(outcome.acked).toBe(0);
    expect(outcome.adoption).toEqual([
      {
        category: 'TEST',
        adopted: 12,
        rejected: 3,
        total: 15,
        ratePercent: 80,
      },
    ]);
  });

  it('STALE 확정만 있는 회차에도 누적 채택률을 낸다', async () => {
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    repository.countAdoptionByCategory.mockResolvedValue([
      { category: 'TEST', status: 'ACKED', count: 10 },
    ]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'MERGED',
      truncated: false,
      threads: [reviewThread()],
    });

    const outcome = await usecase.execute();

    expect(outcome.stale).toBe(1);
    expect(outcome.adoption).toEqual([
      {
        category: 'TEST',
        adopted: 10,
        rejected: 0,
        total: 10,
        ratePercent: 100,
      },
    ]);
  });

  it('채택률 집계가 실패해도 수확 결과는 그대로 낸다', async () => {
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    repository.countAdoptionByCategory.mockRejectedValue(
      new Error('집계 조회 실패'),
    );
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({
          reactions: [
            {
              content: 'THUMBS_UP',
              userLogin: 'owner',
              createdAt: '2026-07-31T01:00:00Z',
            },
          ],
        }),
      ],
    });

    const outcome = await usecase.execute();

    expect(outcome.acked).toBe(1);
    expect(outcome.adoption).toEqual([]);
  });
});
