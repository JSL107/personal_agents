import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { JudgeFindingResolutionUsecase } from '../../agent/review-reply-judge/application/judge-finding-resolution.usecase';
import { JudgeReviewReplyUsecase } from '../../agent/review-reply-judge/application/judge-review-reply.usecase';
import {
  GithubClientPort,
  ReviewThread,
} from '../../github/domain/port/github-client.port';
import { CodexQuotaExceededException } from '../../model-router/infrastructure/codex-cli.provider';
import { LEARNING_REPO } from '../domain/learning-repo';
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

// 판정 경로로 결론난 기각의 실제 형태 — 판단 한 줄 + 근거. 실측(2026-08)상 이런 답글은
// 456~774자였고, 원장에는 판정기가 요약한 9~13자만 남아 학습에서 통째로 빠졌다.
// 길이는 학습 하한(`learned-conventions.ts` 의 MIN_REASON_LENGTH = 40)을 넉넉히 넘긴다 —
// 짧은 답글로 단언하면 저장만 확인하고 그 값이 실제로 규약이 되는지는 못 본다.
// 상수를 직접 import 하지 않는 것은 의도다: pr-review-loop 이 code-reviewer 를 참조하면
// 의존 방향이 뒤집힌다(#382 에서 고친 방향).
const LONG_REJECT_REPLY =
  '이 지적은 받아들이지 않습니다. 이 레포에서 application 이 infrastructure repository 를 ' +
  '직접 주입받는 것은 위반이 아니라 관례입니다. 같은 형태가 최소 12곳입니다.';

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
      contradicted: 0,
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
    // 👎 만으로 확정하지 않고 판정기에 얹는다 — 답글이 수용이면 보류해야 하므로.
    judge.execute.mockResolvedValue([
      { id: 1, verdict: 'REJECTED', reason: '의도된 동작이라 반박했다' },
    ]);
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

    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 1,
      status: 'REJECTED',
      rejectReason: '의도된 동작이라 변경하지 않습니다',
      githubThreadNodeId: 'PRRT_555',
    });
  });

  it('👎 인데 답글이 수용이면 기각으로 확정하지 않고 보류한다', async () => {
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    judge.execute.mockResolvedValue([
      { id: 1, verdict: 'ACCEPTED', reason: '수정했다고 답했다' },
    ]);
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
              createdAt: '2026-08-04T02:03:47Z',
            },
          ],
          replies: [
            {
              databaseId: 556,
              authorLogin: 'owner',
              body: '타당합니다. 8e0d19ad 에 테스트를 추가했습니다.',
              createdAt: '2026-08-04T02:03:13Z',
              reactions: [],
            },
          ],
        }),
      ],
    });

    const outcome = await usecase.execute();

    expect(repository.markDecided).not.toHaveBeenCalled();
    expect(outcome.contradicted).toBe(1);
  });

  it('👎 이고 답글도 기각이면 종전대로 확정한다', async () => {
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    judge.execute.mockResolvedValue([
      { id: 1, verdict: 'REJECTED', reason: '반박했다' },
    ]);
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
              createdAt: '2026-08-04T02:03:47Z',
            },
          ],
          replies: [
            {
              databaseId: 556,
              authorLogin: 'owner',
              body: '전제가 반대입니다. 이 레포에서는 정상 동작입니다.',
              createdAt: '2026-08-04T02:03:13Z',
              reactions: [],
            },
          ],
        }),
      ],
    });

    const outcome = await usecase.execute();

    expect(repository.markDecided).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'REJECTED',
        rejectReason: '전제가 반대입니다. 이 레포에서는 정상 동작입니다.',
      }),
    );
    expect(outcome.contradicted).toBe(0);
  });

  it('👎 인데 답글이 없으면 판정기를 부르지 않는다', async () => {
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    // 유예(Task 4) 와 겹치지 않도록 리액션을 충분히 과거로 둔다.
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
              createdAt: '2020-01-01T00:00:00Z',
            },
          ],
        }),
      ],
    });

    await usecase.execute();

    expect(judge.execute).not.toHaveBeenCalled();
  });

  it('스레드가 잘렸으면 👎 여도 확정하지 않고 경고를 남긴다', async () => {
    // truncated 는 PR 단위 플래그다 — 다른 스레드가 상한을 넘겨도 참이 되므로 이
    // 카드는 멀쩡한데도 매 회차 조용히 이 분기로 떨어질 수 있다. skip 카운터만으로는
    // 아무도 못 보므로 사유가 로그에 드러나야 한다.
    const warnLog = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { usecase, github, repository } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: true,
      threads: [
        reviewThread({
          reactions: [
            {
              content: 'THUMBS_DOWN',
              userLogin: 'owner',
              createdAt: '2020-01-01T00:00:00Z',
            },
          ],
        }),
      ],
    });

    await usecase.execute();

    expect(repository.markDecided).not.toHaveBeenCalled();
    expect(warnLog).toHaveBeenCalledWith(
      expect.stringContaining('JSL107/personal_agents#180'),
    );
    expect(warnLog).toHaveBeenCalledWith(
      expect.stringContaining('스레드 조회가 잘려'),
    );

    warnLog.mockRestore();
  });

  it('PR 작성자만 답글을 달고 owner 가 👎 를 누르면 판정기를 부르지 않고 종전대로 확정한다', async () => {
    // 모순 게이트는 owner 답글이 있을 때만 열려야 한다(harvest-signal.ts 의 ownerLogin
    // 주석 — 제3자 답글이 owner 결정에 개입하면 안 된다). PR 작성자(owner 아님)가
    // "고치겠다" 고 답해도 owner 의 👎 는 그대로 기각으로 확정돼야 한다.
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: 'pr-author',
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({
          reactions: [
            {
              content: 'THUMBS_DOWN',
              userLogin: 'owner',
              createdAt: '2026-08-04T02:03:47Z',
            },
          ],
          replies: [
            {
              databaseId: 556,
              authorLogin: 'pr-author',
              body: '네, 고치겠습니다.',
              createdAt: '2026-08-04T02:03:13Z',
              reactions: [],
            },
          ],
        }),
      ],
    });

    const outcome = await usecase.execute();

    expect(judge.execute).not.toHaveBeenCalled();
    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 1,
      status: 'REJECTED',
      rejectReason: null,
      githubThreadNodeId: 'PRRT_555',
    });
    expect(outcome.contradicted).toBe(0);
  });

  it('같은 답글로 모순이 반복되면 다음 회차는 판정기를 다시 부르지 않는다', async () => {
    // 보류(contradicted)로 남은 카드는 OPEN 인 채 다음 회차에도 같은 signal 로 다시
    // 걸린다. 답글이 안 바뀌었으면 재판정은 매번 같은 결론만 확인하며 쿼터만 태운다.
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    judge.execute.mockResolvedValue([
      { id: 1, verdict: 'ACCEPTED', reason: '수정했다고 답했다' },
    ]);
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
              createdAt: '2026-08-04T02:03:47Z',
            },
          ],
          replies: [
            {
              databaseId: 556,
              authorLogin: 'owner',
              body: '타당합니다. 8e0d19ad 에 테스트를 추가했습니다.',
              createdAt: '2026-08-04T02:03:13Z',
              reactions: [],
            },
          ],
        }),
      ],
    });

    const first = await usecase.execute();
    const second = await usecase.execute();

    expect(judge.execute).toHaveBeenCalledTimes(1);
    expect(first.contradicted).toBe(1);
    expect(second.contradicted).toBe(1);
    expect(repository.markDecided).not.toHaveBeenCalled();
  });

  it('답글만 있던 회차에 지문이 찍혀도 뒤늦게 달린 👎 는 확정된다', async () => {
    // 규약(CLAUDE.md §8-1)이 "답변 먼저, 👎 나중" 이라 이 순서가 정상 경로다. 1회차에
    // 답글 판정이 UNCLEAR 로 끝나면 답글 지문이 찍히는데, 그 가드가 모순 판정 경로까지
    // 걸러내면 뒤늦은 리액션이 영영 확정되지 않는다(답글은 그대로라 지문도 그대로다).
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    const ownerReply = {
      databaseId: 556,
      authorLogin: 'owner',
      body: LONG_REJECT_REPLY,
      createdAt: '2026-08-04T02:03:13Z',
      reactions: [],
    };
    const threadsWith = (
      reactions: ReviewThread['comments'][number]['reactions'],
    ) => ({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN' as const,
      truncated: false,
      threads: [reviewThread({ reactions, replies: [ownerReply] })],
    });
    github.listReviewThreads
      .mockResolvedValueOnce(threadsWith([]))
      .mockResolvedValueOnce(
        threadsWith([
          {
            content: 'THUMBS_DOWN',
            userLogin: 'owner',
            createdAt: '2026-08-04T02:03:47Z',
          },
        ]),
      );
    judge.execute
      .mockResolvedValueOnce([
        { id: 1, verdict: 'UNCLEAR', reason: '판단 보류' },
      ])
      .mockResolvedValueOnce([
        { id: 1, verdict: 'REJECTED', reason: '반박으로 읽힌다' },
      ]);

    const first = await usecase.execute();
    const second = await usecase.execute();

    expect(first.skipped).toBe(1);
    expect(judge.execute).toHaveBeenCalledTimes(2);
    expect(second.rejected).toBe(1);
    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 1,
      status: 'REJECTED',
      rejectReason: LONG_REJECT_REPLY,
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
          replies: [reply(601, LONG_REJECT_REPLY)],
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
    // 판정기의 요약('의도된 동작')이 아니라 사람이 쓴 답글 원문을 남긴다 — 이 값이
    // 그대로 다음 리뷰의 레포 규약이 되므로, 요약을 저장하면 학습 재료가 파괴된다.
    // 답글을 길게 둔 것은 의도다: 저장값이 학습 하한(MIN_REASON_LENGTH=40)을 넘어야
    // 실제로 규약이 된다. 짧은 답글로 단언하면 저장만 확인하고 학습은 못 본다.
    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 2,
      status: 'REJECTED',
      rejectReason: LONG_REJECT_REPLY,
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

  it('카드 상태가 바뀌면 구간 채택률을 함께 낸다', async () => {
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
        // mock 이 최근·직전 두 조회에 같은 값을 돌려주므로 변화는 0 이다.
        changePercentPoint: 0,
      },
    ]);
  });

  // 이 회차에 반응이 없어도 구간 채택률은 실어야 한다. 이 그룹의 Slack 발송은 하루 1회뿐이라
  // (autopilot.orchestrator buildGuardKey), 반응이 있던 회차가 그날 첫 발송이 아니면 그대로
  // 차단된다 — 조회를 반응 있는 회차로 아끼면 그 값이 영영 안 나온다.
  it('반응이 없는 회차에도 구간 채택률을 낸다', async () => {
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
        // mock 이 최근·직전 두 조회에 같은 값을 돌려주므로 변화는 0 이다.
        changePercentPoint: 0,
      },
    ]);
  });

  it('STALE 확정만 있는 회차에도 구간 채택률을 낸다', async () => {
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
        changePercentPoint: 0,
      },
    ]);
  });

  it('최근 구간과 그 직전 같은 길이 구간을 조회한다', async () => {
    // 두 조회에 같은 mock 을 물리면 구간 계산이 통째로 틀려도 결과가 같아 보인다 —
    // 실제로 `windowMs * 2` 를 `windowMs` 로 바꿔도 다른 테스트는 전부 통과했다.
    // 여기서만 호출 인자를 직접 본다.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T00:00:00.000Z'));
    try {
      const { usecase, github, repository } = buildDependencies();
      repository.findOpenPostedCards.mockResolvedValue([card()]);
      github.listReviewThreads.mockResolvedValue({
        pullRequestAuthorLogin: null,
        pullRequestState: 'OPEN',
        truncated: false,
        threads: [reviewThread()],
      });

      await usecase.execute();

      const recentSince = new Date('2026-08-12T00:00:00.000Z');
      expect(repository.countAdoptionByCategory).toHaveBeenCalledTimes(2);
      // 최근 구간은 상한이 없다 — 지금 결론이 나는 카드까지 세어야 한다.
      // 두 구간 모두 학습 규약이 실리는 레포로 한정한다. 전 레포를 합산하면 규약이
      // 실리지도 않는 레포의 결론이 섞여 규약 효과를 물어볼 수 없다.
      expect(repository.countAdoptionByCategory).toHaveBeenCalledWith({
        repo: LEARNING_REPO,
        since: recentSince,
      });
      // 직전 구간은 같은 길이로 맞닿아 있다. 경계가 어긋나면 두 비율의 기준이 달라진다.
      expect(repository.countAdoptionByCategory).toHaveBeenCalledWith({
        repo: LEARNING_REPO,
        since: new Date('2026-07-29T00:00:00.000Z'),
        until: recentSince,
      });
    } finally {
      jest.useRealTimers();
    }
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

  it('답글 없는 THUMBS_DOWN 은 유예 동안 확정하지 않는다', async () => {
    // 확정하면 status 가 OPEN 이 아니게 되어 다음 회차 조회에서 빠지고, 뒤늦게 단
    // 반박 답글이 영영 수확되지 않는다. 이유 없는 기각은 규약 재료도 못 된다.
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
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      ],
    });

    const outcome = await usecase.execute();

    expect(repository.markDecided).not.toHaveBeenCalled();
    expect(outcome.rejected).toBe(0);
    expect(outcome.skipped).toBe(1);
  });

  it('유예가 지난 답글 없는 THUMBS_DOWN 은 이유 없이라도 확정한다', async () => {
    // 계속 미루면 PR 이 닫힐 때 STALE 로 끝나 기각 사실 자체가 사라진다.
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
              createdAt: new Date(
                Date.now() - 25 * 60 * 60 * 1000,
              ).toISOString(),
            },
          ],
        }),
      ],
    });

    await usecase.execute();

    expect(repository.markDecided).toHaveBeenCalledWith({
      id: 1,
      status: 'REJECTED',
      rejectReason: null,
      githubThreadNodeId: 'PRRT_555',
    });
  });

  it('답글이 그대로면 다음 회차에 같은 답글을 다시 판정하지 않는다', async () => {
    // UNCLEAR 는 카드를 OPEN 으로 남기므로, 가드가 없으면 5분마다 같은 답글로 CLI 를
    // 다시 태운다. 해소 판정에는 같은 checkpoint 가 이미 있다.
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    judge.execute.mockResolvedValue([
      { id: 1, verdict: 'UNCLEAR', reason: '' },
    ]);
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({
          replies: [
            {
              databaseId: 556,
              authorLogin: 'owner',
              body: '확인했습니다',
              createdAt: '2026-07-31T02:00:00Z',
              reactions: [],
            },
          ],
        }),
      ],
    });

    await usecase.execute();
    await usecase.execute();

    expect(judge.execute).toHaveBeenCalledTimes(1);
  });

  it('판정 호출이 실패하면 다음 회차에 다시 판정한다 — 미결로 굳지 않는다', async () => {
    // checkpoint 를 판정 성공 전에 찍으면 응답 형식 위반 한 번으로 그 답글이 영구히
    // 미결이 된다. 실패 회차는 기록하지 않아야 한다.
    const { usecase, github, repository, judge } = buildDependencies();
    repository.findOpenPostedCards.mockResolvedValue([card()]);
    judge.execute.mockRejectedValue(
      new Error('답글 판정 응답에서 JSON 배열을 뽑지 못했다 (항목 1건)'),
    );
    github.listReviewThreads.mockResolvedValue({
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
      threads: [
        reviewThread({
          replies: [
            {
              databaseId: 556,
              authorLogin: 'owner',
              body: '확인했습니다',
              createdAt: '2026-07-31T02:00:00Z',
              reactions: [],
            },
          ],
        }),
      ],
    });

    await usecase.execute();
    await usecase.execute();

    expect(judge.execute).toHaveBeenCalledTimes(2);
    expect(repository.markDecided).not.toHaveBeenCalled();
  });

  it('제3자 답글만 있고 owner 답글이 없으면 유예를 유지한다', async () => {
    // 기각 이유로 저장되는 값은 owner 답글뿐이다. 임의 답글의 존재로 유예를 끝내면
    // rejectReason 이 null 인 채 확정돼 이 유예가 막으려는 유실이 그대로 일어난다.
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
              content: 'THUMBS_DOWN',
              userLogin: 'owner',
              createdAt: new Date().toISOString(),
            },
          ],
          replies: [
            {
              databaseId: 556,
              authorLogin: 'pr-author',
              body: '제3자가 남긴 답글',
              createdAt: '2026-07-31T02:00:00Z',
              reactions: [],
            },
          ],
        }),
      ],
    });

    const outcome = await usecase.execute();

    expect(repository.markDecided).not.toHaveBeenCalled();
    expect(outcome.rejected).toBe(0);
  });
});
