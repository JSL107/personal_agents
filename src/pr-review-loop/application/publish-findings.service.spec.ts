import { ConfigService } from '@nestjs/config';

import { ReviewFinding } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { PullRequestDetail } from '../../github/domain/github.type';
import {
  GithubClientPort,
  ReviewThread,
} from '../../github/domain/port/github-client.port';
import { IDAERI_REVIEW_MARKER } from '../domain/finding-comment.body';
import { PrReviewFindingRepositoryPort } from '../domain/port/pr-review-finding.repository.port';
import {
  CreateFindingInput,
  PrReviewFindingRecord,
} from '../domain/pr-review-finding.type';
import { RISK_MAP_COMMENT_TAG } from '../domain/risk-map-comment.body';
import { PublishFindingsService } from './publish-findings.service';
import { ReviewWriterResolver } from './review-writer.resolver';

const buildWriters = ({
  owner,
  bot = null,
  env = {},
}: {
  owner: unknown;
  bot?: unknown;
  env?: Record<string, string | undefined>;
}): ReviewWriterResolver =>
  new ReviewWriterResolver(
    { get: (key: string) => env[key] } as unknown as ConfigService,
    owner as GithubClientPort,
    bot as GithubClientPort | null,
  );

const BOT_ENV = {
  GITHUB_WEBHOOK_OWNER_LOGIN: 'JSL107',
  GITHUB_REVIEW_BOT_LOGIN: 'idaeri-bot',
  GITHUB_REVIEW_BOT_REPOS: 'JSL107/personal_agents',
};

const DIFF = `--- a/src/foo.service.ts
+++ b/src/foo.service.ts
@@ -10,3 +10,5 @@
+  const b = 2;
`;

const finding = (overrides: Partial<ReviewFinding> = {}): ReviewFinding => ({
  category: 'RELIABILITY',
  severity: 'MUST_FIX',
  file: 'src/foo.service.ts',
  line: 12,
  body: '트랜잭션 밖에서 저장한다',
  ...overrides,
});

const buildGithub = () =>
  ({
    createReviewComment: jest.fn(),
    addIssueComment: jest.fn(),
    listReviewThreads: jest.fn(),
    listIssueComments: jest.fn(),
    getPullRequestHeadSha: jest.fn(),
    getPullRequestDiff: jest.fn(),
  }) as unknown as jest.Mocked<
    Pick<
      GithubClientPort,
      | 'createReviewComment'
      | 'addIssueComment'
      | 'listReviewThreads'
      | 'listIssueComments'
      | 'getPullRequestHeadSha'
      | 'getPullRequestDiff'
    >
  >;

const buildRepository = () =>
  ({
    createIfAbsent: jest.fn(),
    hasAnyForPullRequest: jest.fn(),
    markPosted: jest.fn(),
    findOpenPostedCards: jest.fn(),
    findUnpostedOpenCards: jest.fn(),
    findLinkedCommentIds: jest.fn().mockResolvedValue([]),
    markDecided: jest.fn(),
    markThreadResolved: jest.fn(),
    countAdoptionByCategory: jest.fn().mockResolvedValue([]),
  }) as unknown as jest.Mocked<PrReviewFindingRepositoryPort>;

const recordFrom = (input: CreateFindingInput): PrReviewFindingRecord => ({
  id: 1,
  agentRunId: input.agentRunId,
  repo: input.repo,
  pullNumber: input.pullNumber,
  headSha: input.headSha,
  category: input.category,
  severity: input.severity,
  filePath: input.filePath,
  line: input.line,
  body: input.body,
  fingerprint: input.fingerprint,
  status: 'OPEN',
  postMode: input.postMode,
  githubCommentId: null,
  githubThreadNodeId: null,
  heldReplyHash: null,
  heldAt: null,
  createdAt: new Date(),
});

// 복구는 만든 지 5분이 지난 카드만 본다(진행 중인 게시와 겹치지 않게). 복구 테스트의 카드는 오래된 카드로 만든다.
const settledCard = (input: CreateFindingInput): PrReviewFindingRecord => ({
  ...recordFrom(input),
  createdAt: new Date(Date.now() - 10 * 60 * 1000),
});

const baseInput = (findings: ReviewFinding[]) => ({
  agentRunId: 7,
  repo: 'JSL107/personal_agents',
  pullNumber: 180,
  headSha: 'abc1234',
  diff: DIFF,
  diffTotalBytes: Buffer.byteLength(DIFF),
  findings,
  max: 4,
  dryRun: false,
  allowlistRaw: 'JSL107/personal_agents',
});

describe('PublishFindingsService', () => {
  let github: ReturnType<typeof buildGithub>;
  let repository: ReturnType<typeof buildRepository>;
  let service: PublishFindingsService;

  beforeEach(() => {
    github = buildGithub();
    repository = buildRepository();
    repository.createIfAbsent.mockImplementation(async (input) =>
      recordFrom(input),
    );
    service = new PublishFindingsService(
      github as unknown as GithubClientPort,
      repository,
      buildWriters({ owner: github }),
    );
  });

  it('기존 스레드와 일치하는 카드는 중복 게시하지 않고 복구한다', async () => {
    const card = settledCard({
      ...baseInput([]),
      agentType: 'CODE_REVIEWER',
      category: 'RELIABILITY',
      severity: 'MUST_FIX',
      filePath: 'src/foo.service.ts',
      line: 12,
      body: '트랜잭션 밖에서 저장한다',
      fingerprint: 'fp',
      postMode: 'NOT_POSTED',
    });
    repository.findUnpostedOpenCards.mockResolvedValue([card]);
    github.listReviewThreads.mockResolvedValue({
      threads: [
        {
          threadId: 'thread',
          isResolved: false,
          comments: [
            {
              databaseId: 42,
              body: `${IDAERI_REVIEW_MARKER} · RELIABILITY / MUST_FIX\n\n트랜잭션 밖에서 저장한다`,
              authorLogin: null,
              createdAt: '',
              reactions: [],
            },
          ],
        },
      ],
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
    });
    github.listIssueComments.mockResolvedValue([]);
    expect(await service.recoverUnposted(baseInput([]))).toBe(1);
    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(repository.markPosted).toHaveBeenCalledWith({
      id: 1,
      postMode: 'INLINE',
      githubCommentId: '42',
      githubThreadNodeId: 'thread',
    });
  });

  it('없는 카드는 폴백 게시하고 상태를 기록한다', async () => {
    const card = settledCard({
      ...baseInput([]),
      agentType: 'CODE_REVIEWER',
      category: 'RELIABILITY',
      severity: 'MUST_FIX',
      filePath: 'src/foo.service.ts',
      line: 12,
      body: '문제',
      fingerprint: 'fp',
      postMode: 'NOT_POSTED',
    });
    repository.findUnpostedOpenCards.mockResolvedValue([card]);
    github.listReviewThreads.mockResolvedValue({
      threads: [],
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
    });
    github.listIssueComments.mockResolvedValue([]);
    // 카드와 같은 head — 줄 위치를 믿을 수 있어 인라인부터 시도한다.
    github.getPullRequestHeadSha.mockResolvedValue('abc1234');
    github.getPullRequestDiff.mockResolvedValue({
      diff: DIFF,
      bytes: DIFF.length,
      truncated: false,
    });
    github.createReviewComment
      .mockRejectedValueOnce(new Error('inline'))
      .mockResolvedValueOnce({ commentId: '5', nodeId: 'thread' });
    expect(await service.recoverUnposted(baseInput([]))).toBe(1);
    expect(repository.markPosted).toHaveBeenCalledWith(
      expect.objectContaining({ postMode: 'FILE', githubCommentId: '5' }),
    );
  });

  // 카드를 만든 뒤 push 가 있었으면 저장된 줄 번호가 지금 코드와 어긋난다. 스냅으로 엉뚱한 줄에 붙이지
  // 않고 처음부터 파일 단위로 올린다.
  it('카드 이후 head 가 바뀌었으면 줄에 붙이지 않고 파일 단위로 게시한다', async () => {
    const card = settledCard({
      ...baseInput([]),
      agentType: 'CODE_REVIEWER',
      category: 'RELIABILITY',
      severity: 'MUST_FIX',
      filePath: 'src/foo.service.ts',
      line: 12,
      body: '문제',
      fingerprint: 'fp',
      postMode: 'NOT_POSTED',
    });
    repository.findUnpostedOpenCards.mockResolvedValue([card]);
    github.listReviewThreads.mockResolvedValue({
      threads: [],
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
    });
    github.listIssueComments.mockResolvedValue([]);
    github.getPullRequestHeadSha.mockResolvedValue('new');
    github.getPullRequestDiff.mockResolvedValue({
      diff: DIFF,
      bytes: DIFF.length,
      truncated: false,
    });
    github.createReviewComment.mockResolvedValueOnce({
      commentId: '6',
      nodeId: 'thread',
    });
    expect(await service.recoverUnposted(baseInput([]))).toBe(1);
    expect(github.createReviewComment).toHaveBeenCalledTimes(1);
    expect(github.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ line: null, commitSha: 'new' }),
    );
    expect(repository.markPosted).toHaveBeenCalledWith(
      expect.objectContaining({ postMode: 'FILE', githubCommentId: '6' }),
    );
  });

  const cardInput = (body: string, filePath: string | null) => ({
    ...baseInput([]),
    agentType: 'CODE_REVIEWER' as const,
    category: 'RELIABILITY' as const,
    severity: 'MUST_FIX' as const,
    filePath,
    line: null,
    body,
    fingerprint: `fp-${filePath ?? 'pr'}`,
    postMode: 'NOT_POSTED' as const,
  });

  it('만든 지 얼마 안 된 카드는 다른 경로가 게시 중일 수 있어 복구하지 않는다', async () => {
    repository.findUnpostedOpenCards.mockResolvedValue([
      recordFrom(cardInput('문제', 'src/foo.service.ts')),
    ]);
    expect(await service.recoverUnposted(baseInput([]))).toBe(0);
    expect(github.listReviewThreads).not.toHaveBeenCalled();
    expect(github.createReviewComment).not.toHaveBeenCalled();
  });

  it('이미 닫힌 PR 에는 복구 게시하지 않는다', async () => {
    repository.findUnpostedOpenCards.mockResolvedValue([
      settledCard(cardInput('문제', 'src/foo.service.ts')),
    ]);
    github.listReviewThreads.mockResolvedValue({
      threads: [],
      pullRequestAuthorLogin: null,
      pullRequestState: 'MERGED',
      truncated: false,
    });
    github.listIssueComments.mockResolvedValue([]);
    // 아래 조회가 모두 성공하는 상황이어야 상태 확인이 빠졌을 때 실제로 게시까지 간다.
    github.getPullRequestHeadSha.mockResolvedValue('abc1234');
    github.getPullRequestDiff.mockResolvedValue({
      diff: DIFF,
      bytes: DIFF.length,
      truncated: false,
    });
    github.createReviewComment.mockResolvedValue({
      commentId: '5',
      nodeId: 'thread',
    });
    expect(await service.recoverUnposted(baseInput([]))).toBe(0);
    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(github.addIssueComment).not.toHaveBeenCalled();
    expect(repository.markPosted).not.toHaveBeenCalled();
  });

  it('같은 문장의 카드가 둘이고 하나만 올라갔으면 나머지 하나는 게시한다', async () => {
    const posted = { ...settledCard(cardInput('문제', 'src/a.ts')), id: 1 };
    const missing = {
      ...settledCard(cardInput('문제', 'src/foo.service.ts')),
      id: 2,
    };
    repository.findUnpostedOpenCards.mockResolvedValue([posted, missing]);
    github.listReviewThreads.mockResolvedValue({
      threads: [
        {
          threadId: 'thread',
          isResolved: false,
          comments: [
            {
              databaseId: 42,
              body: `${IDAERI_REVIEW_MARKER} · RELIABILITY / MUST_FIX\n\n문제`,
              authorLogin: null,
              createdAt: '',
              reactions: [],
            },
          ],
        },
      ],
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
    });
    github.listIssueComments.mockResolvedValue([]);
    github.getPullRequestHeadSha.mockResolvedValue('abc1234');
    github.getPullRequestDiff.mockResolvedValue({
      diff: DIFF,
      bytes: DIFF.length,
      truncated: false,
    });
    github.createReviewComment.mockResolvedValue({
      commentId: '9',
      nodeId: 'thread-2',
    });
    expect(await service.recoverUnposted(baseInput([]))).toBe(2);
    expect(github.createReviewComment).toHaveBeenCalledTimes(1);
    expect(repository.markPosted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, githubCommentId: '42' }),
    );
    expect(repository.markPosted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, githubCommentId: '9' }),
    );
  });

  // 같은 문장의 카드가 다른 파일에 하나 정상 게시돼 있고 하나만 실패했다. 실패 카드가 정상 카드의 코멘트에
  // "게시됨" 으로 붙으면 그 지적이 끝내 안 올라간다 — 이미 다른 카드에 붙은 코멘트는 대상에서 뺀다(#931 리뷰).
  it('다른 카드에 이미 연결된 코멘트에는 미게시 카드를 붙이지 않는다', async () => {
    const missing = {
      ...settledCard(cardInput('문제', 'src/foo.service.ts')),
      id: 2,
    };
    repository.findUnpostedOpenCards.mockResolvedValue([missing]);
    repository.findLinkedCommentIds.mockResolvedValue(['42']);
    github.listReviewThreads.mockResolvedValue({
      threads: [
        {
          threadId: 'thread',
          isResolved: false,
          comments: [
            {
              databaseId: 42,
              body: `${IDAERI_REVIEW_MARKER} · RELIABILITY / MUST_FIX\n\n문제`,
              authorLogin: null,
              createdAt: '',
              reactions: [],
            },
          ],
        },
      ],
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
    });
    github.listIssueComments.mockResolvedValue([]);
    github.getPullRequestHeadSha.mockResolvedValue('abc1234');
    github.getPullRequestDiff.mockResolvedValue({
      diff: DIFF,
      bytes: DIFF.length,
      truncated: false,
    });
    github.createReviewComment.mockResolvedValue({
      commentId: '9',
      nodeId: 'thread-2',
    });
    expect(await service.recoverUnposted(baseInput([]))).toBe(1);
    expect(github.createReviewComment).toHaveBeenCalledTimes(1);
    expect(repository.markPosted).not.toHaveBeenCalledWith(
      expect.objectContaining({ githubCommentId: '42' }),
    );
    expect(repository.markPosted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, githubCommentId: '9' }),
    );
  });

  const openThreads = (threads: ReviewThread[]) => ({
    threads,
    pullRequestAuthorLogin: null,
    pullRequestState: 'OPEN' as const,
    truncated: false,
  });
  const mockFreshDiff = () => {
    github.getPullRequestHeadSha.mockResolvedValue('abc1234');
    github.getPullRequestDiff.mockResolvedValue({
      diff: DIFF,
      bytes: DIFF.length,
      truncated: false,
    });
  };

  // 같은 문장의 카드 두 장 중 뒤 카드(foo.service.ts)만 실제로 올라갔다. 앞 카드(a.ts)가 그 코멘트를
  // 가져가면 앞 카드의 지적은 안 올라가고 뒤 카드는 두 번 올라간다 — 스레드 경로까지 맞춘다(#931 리뷰).
  it('같은 문장이라도 다른 파일 스레드의 코멘트는 그 카드의 게시물로 잡지 않는다', async () => {
    const front = { ...settledCard(cardInput('문제', 'src/a.ts')), id: 1 };
    const back = {
      ...settledCard(cardInput('문제', 'src/foo.service.ts')),
      id: 2,
    };
    repository.findUnpostedOpenCards.mockResolvedValue([front, back]);
    github.listReviewThreads.mockResolvedValue(
      openThreads([
        {
          threadId: 'thread-foo',
          isResolved: false,
          path: 'src/foo.service.ts',
          comments: [
            {
              databaseId: 42,
              body: `${IDAERI_REVIEW_MARKER} · RELIABILITY / MUST_FIX\n\n문제`,
              authorLogin: null,
              createdAt: '',
              reactions: [],
            },
          ],
        },
      ]),
    );
    github.listIssueComments.mockResolvedValue([]);
    mockFreshDiff();
    expect(await service.recoverUnposted(baseInput([]))).toBe(2);
    expect(repository.markPosted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, githubCommentId: '42' }),
    );
    expect(repository.markPosted).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, githubCommentId: '42' }),
    );
    // a.ts 는 diff 에 없어 PR 전체 의견으로 올라간다 — 중요한 건 앞 카드가 실제로 게시된다는 점이다.
    expect(github.addIssueComment).toHaveBeenCalledTimes(1);
  });

  // "…문제" 항목은 "…문제가 더 있다" 항목 안에도 부분 문자열로 들어 있다. 항목 단위로 완전히 같을 때만 인정한다(#931 리뷰).
  it('PR 전체 의견에 본문을 접두어로만 품은 다른 항목이 있으면 게시된 것으로 보지 않는다', async () => {
    repository.findUnpostedOpenCards.mockResolvedValue([
      settledCard(cardInput('문제', null)),
    ]);
    github.listReviewThreads.mockResolvedValue(openThreads([]));
    github.listIssueComments.mockResolvedValue([
      {
        id: 7,
        body: `${IDAERI_REVIEW_MARKER} · PR 전체 의견\n\n- **RELIABILITY / MUST_FIX** — 문제가 더 있다`,
        authorLogin: '',
      },
    ]);
    mockFreshDiff();
    expect(await service.recoverUnposted(baseInput([]))).toBe(1);
    expect(repository.markPosted).not.toHaveBeenCalledWith(
      expect.objectContaining({ githubCommentId: '7' }),
    );
    expect(github.addIssueComment).toHaveBeenCalledTimes(1);
  });

  // 작성 계정을 알면 그 계정이 쓴 코멘트만 이 카드의 게시물로 본다. 남이 같은 문장을 달아 둔 스레드에 카드를
  // 붙이면 수확기가 남의 스레드 반응을 이 카드의 판정으로 읽는다(#931 리뷰).
  it('작성 계정을 알면 다른 사람이 단 같은 본문 코멘트는 게시물로 잡지 않는다', async () => {
    const serviceWithLogin = new PublishFindingsService(
      github as unknown as GithubClientPort,
      repository,
      buildWriters({
        owner: github,
        env: { GITHUB_WEBHOOK_OWNER_LOGIN: 'JSL107' },
      }),
    );
    repository.findUnpostedOpenCards.mockResolvedValue([
      settledCard(cardInput('문제', 'src/foo.service.ts')),
    ]);
    github.listReviewThreads.mockResolvedValue(
      openThreads([
        {
          threadId: 'thread-other',
          isResolved: false,
          path: 'src/foo.service.ts',
          comments: [
            {
              databaseId: 50,
              body: `${IDAERI_REVIEW_MARKER} · RELIABILITY / MUST_FIX\n\n문제`,
              authorLogin: 'someone-else',
              createdAt: '',
              reactions: [],
            },
          ],
        },
      ]),
    );
    github.listIssueComments.mockResolvedValue([]);
    mockFreshDiff();
    github.createReviewComment.mockResolvedValue({
      commentId: '51',
      nodeId: 'thread-mine',
    });
    expect(await serviceWithLogin.recoverUnposted(baseInput([]))).toBe(1);
    expect(repository.markPosted).not.toHaveBeenCalledWith(
      expect.objectContaining({ githubCommentId: '50' }),
    );
    expect(repository.markPosted).toHaveBeenCalledWith(
      expect.objectContaining({ githubCommentId: '51' }),
    );
  });

  it('GitHub 목록 조회 실패는 경고하고 게시하지 않는다', async () => {
    const card = settledCard({
      ...baseInput([]),
      agentType: 'CODE_REVIEWER',
      category: 'RELIABILITY',
      severity: 'MUST_FIX',
      filePath: null,
      line: null,
      body: '문제',
      fingerprint: 'fp',
      postMode: 'NOT_POSTED',
    });
    repository.findUnpostedOpenCards.mockResolvedValue([card]);
    github.listReviewThreads.mockRejectedValue(new Error('offline'));
    github.listIssueComments.mockResolvedValue([]);
    await expect(service.recoverUnposted(baseInput([]))).resolves.toBe(0);
    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(github.addIssueComment).not.toHaveBeenCalled();
  });

  it('PR 전체 의견에 카드가 있으면 중복 게시하지 않는다', async () => {
    const card = settledCard({
      ...baseInput([]),
      agentType: 'CODE_REVIEWER',
      category: 'RELIABILITY',
      severity: 'MUST_FIX',
      filePath: null,
      line: null,
      body: '문제',
      fingerprint: 'fp',
      postMode: 'NOT_POSTED',
    });
    repository.findUnpostedOpenCards.mockResolvedValue([card]);
    github.listReviewThreads.mockResolvedValue({
      threads: [],
      pullRequestAuthorLogin: null,
      pullRequestState: 'OPEN',
      truncated: false,
    });
    github.listIssueComments.mockResolvedValue([
      {
        id: 7,
        body: `${IDAERI_REVIEW_MARKER} · PR 전체 의견\n\n- **RELIABILITY / MUST_FIX** — 문제`,
        authorLogin: 'bot',
      },
    ]);
    expect(await service.recoverUnposted(baseInput([]))).toBe(1);
    expect(github.addIssueComment).not.toHaveBeenCalled();
    expect(repository.markPosted).toHaveBeenCalledWith(
      expect.objectContaining({
        postMode: 'ISSUE_COMMENT',
        githubCommentId: '7',
      }),
    );
  });

  it('조회 실패는 삼키고 연습 모드와 허용 목록 밖은 조회하지 않는다', async () => {
    repository.findUnpostedOpenCards.mockRejectedValue(new Error('offline'));
    await expect(service.recoverUnposted(baseInput([]))).resolves.toBe(0);
    repository.findUnpostedOpenCards.mockClear();
    await service.recoverUnposted({ ...baseInput([]), dryRun: true });
    await service.recoverUnposted({
      ...baseInput([]),
      allowlistRaw: 'other/repo',
    });
    expect(repository.findUnpostedOpenCards).not.toHaveBeenCalled();
  });

  it('diff 범위 안의 줄은 인라인으로 게시한다', async () => {
    github.createReviewComment.mockResolvedValue({
      commentId: '555',
      nodeId: 'PRRC_a',
    });

    const outcome = await service.publish(baseInput([finding()]));

    expect(github.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        line: 12,
        filePath: 'src/foo.service.ts',
        body: '🤖 **이대리 자동 리뷰** · RELIABILITY / MUST_FIX\n\n트랜잭션 밖에서 저장한다',
      }),
    );
    expect(repository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ body: '트랜잭션 밖에서 저장한다' }),
    );
    expect(outcome.inline).toBe(1);
    expect(repository.markPosted).toHaveBeenCalledWith({
      id: 1,
      postMode: 'INLINE',
      githubCommentId: '555',
      githubThreadNodeId: 'PRRC_a',
    });
  });

  describe('잘린 diff 안내', () => {
    it('지적을 게시했고 diff 가 잘렸으면 본 바이트/전체 바이트를 일반 코멘트로 남긴다', async () => {
      github.createReviewComment.mockResolvedValue({
        commentId: '555',
        nodeId: 'PRRC_a',
      });

      await service.publish({
        ...baseInput([finding()]),
        diffTotalBytes: 120_000,
      });

      expect(github.addIssueComment).toHaveBeenCalledTimes(1);
      const { body } = github.addIssueComment.mock.calls[0][0];
      expect(body.startsWith('🤖 **이대리 자동 리뷰** · 부분 검토')).toBe(true);
      expect(body).toContain(
        `diff ${Buffer.byteLength(DIFF)}/120,000 바이트만 검토`,
      );
    });

    it('안 잘렸으면 남기지 않는다', async () => {
      github.createReviewComment.mockResolvedValue({
        commentId: '555',
        nodeId: 'PRRC_a',
      });

      await service.publish(baseInput([finding()]));

      expect(github.addIssueComment).not.toHaveBeenCalled();
    });

    it('게시한 지적이 없으면(전부 중복) 남기지 않는다', async () => {
      repository.createIfAbsent.mockResolvedValue(null);

      await service.publish({
        ...baseInput([finding()]),
        diffTotalBytes: 120_000,
      });

      expect(github.addIssueComment).not.toHaveBeenCalled();
    });

    it('지적 0건이어도 잘렸으면 남긴다 — 온디맨드 경로는 이 안내 말고는 PR 에 흔적이 없다', async () => {
      await service.publish({ ...baseInput([]), diffTotalBytes: 120_000 });

      expect(github.addIssueComment).toHaveBeenCalledTimes(1);
      expect(github.addIssueComment.mock.calls[0][0].body).toContain(
        '부분 검토',
      );
    });

    it('게시 허용 레포가 아니면 지적 0건이어도 남기지 않는다', async () => {
      await service.publish({
        ...baseInput([]),
        diffTotalBytes: 120_000,
        allowlistRaw: 'other/repo',
      });

      expect(github.addIssueComment).not.toHaveBeenCalled();
    });

    it('안내 게시가 실패해도 게시 결과는 그대로다', async () => {
      github.createReviewComment.mockResolvedValue({
        commentId: '555',
        nodeId: 'PRRC_a',
      });
      github.addIssueComment.mockRejectedValue(new Error('boom'));

      const outcome = await service.publish({
        ...baseInput([finding()]),
        diffTotalBytes: 120_000,
      });

      expect(outcome.inline).toBe(1);
    });
  });

  it('diff 범위 밖 줄은 가까운 줄로 스냅해 게시한다', async () => {
    github.createReviewComment.mockResolvedValue({
      commentId: '556',
      nodeId: 'PRRC_b',
    });

    await service.publish(baseInput([finding({ line: 16 })]));

    expect(github.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ line: 14 }),
    );
  });

  it('스냅이 불가능하면 파일 단위로 강등한다', async () => {
    github.createReviewComment.mockResolvedValue({
      commentId: '557',
      nodeId: 'PRRC_c',
    });

    const outcome = await service.publish(baseInput([finding({ line: 900 })]));

    expect(github.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ line: null }),
    );
    expect(outcome.file).toBe(1);
  });

  it('줄 게시가 거절되면 같은 파일에 파일 단위로 다시 단다 — 스레드여야 수확된다', async () => {
    github.createReviewComment
      .mockRejectedValueOnce(new Error('422'))
      .mockResolvedValueOnce({ commentId: '559', nodeId: 'PRRC_g' });

    const outcome = await service.publish(baseInput([finding()]));

    expect(github.createReviewComment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ filePath: 'src/foo.service.ts', line: 12 }),
    );
    expect(github.createReviewComment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ filePath: 'src/foo.service.ts', line: null }),
    );
    expect(outcome.file).toBe(1);
    expect(github.addIssueComment).not.toHaveBeenCalled();
    expect(repository.markPosted).toHaveBeenCalledWith(
      expect.objectContaining({
        postMode: 'FILE',
        githubCommentId: '559',
        githubThreadNodeId: 'PRRC_g',
      }),
    );
  });

  it('처음부터 파일 단위였는데 거절되면 재시도 없이 PR 전체 의견으로 간다', async () => {
    github.createReviewComment.mockRejectedValue(new Error('422'));
    github.addIssueComment.mockResolvedValue(undefined);

    const outcome = await service.publish(baseInput([finding({ line: 900 })]));

    expect(github.createReviewComment).toHaveBeenCalledTimes(1);
    expect(outcome.issueComment).toBe(1);
  });

  it('줄·파일 게시가 모두 실패하면 PR 전체 의견 코멘트로 올린다', async () => {
    github.createReviewComment.mockRejectedValue(new Error('422'));
    github.addIssueComment.mockResolvedValue(undefined);

    const outcome = await service.publish(baseInput([finding()]));

    expect(github.createReviewComment).toHaveBeenCalledTimes(2);
    expect(github.addIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'JSL107/personal_agents',
        number: 180,
        body:
          '🤖 **이대리 자동 리뷰** · PR 전체 의견\n\n' +
          '- **RELIABILITY / MUST_FIX** — 트랜잭션 밖에서 저장한다',
      }),
    );
    expect(outcome.issueComment).toBe(1);
    expect(repository.markPosted).toHaveBeenCalledWith(
      expect.objectContaining({ postMode: 'ISSUE_COMMENT' }),
    );
  });

  it('파일 정보가 없는 카드는 곧바로 일반 코멘트로 간다', async () => {
    github.addIssueComment.mockResolvedValue(undefined);

    const outcome = await service.publish(
      baseInput([finding({ file: undefined, line: undefined })]),
    );

    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(outcome.issueComment).toBe(1);
  });

  it('diff 에 없는 경로는 인라인 게시를 시도하지 않고 일반 코멘트로 간다', async () => {
    github.addIssueComment.mockResolvedValue(undefined);

    const outcome = await service.publish(
      baseInput([finding({ file: 'PR 본문', line: 1 })]),
    );

    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(outcome.issueComment).toBe(1);
  });

  it('연습 모드에서는 GitHub 도 DB 도 건드리지 않는다', async () => {
    const outcome = await service.publish({
      ...baseInput([finding()]),
      dryRun: true,
    });

    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(github.addIssueComment).not.toHaveBeenCalled();
    expect(repository.createIfAbsent).not.toHaveBeenCalled();
    expect(outcome.dryRun).toBe(1);
  });

  it('연습 모드에서 상한을 넘으면 dropped 도 집계하되 DB 는 여전히 건드리지 않는다', async () => {
    const outcome = await service.publish({
      ...baseInput([
        finding({ body: 'a' }),
        finding({ body: 'b', severity: 'NICE_TO_HAVE' }),
      ]),
      dryRun: true,
      max: 1,
    });

    expect(repository.createIfAbsent).not.toHaveBeenCalled();
    expect(outcome.dryRun).toBe(1);
    expect(outcome.dropped).toBe(1);
  });

  it('allowlist 밖 레포는 게시하지 않고 NOT_POSTED 로 기록한다', async () => {
    const outcome = await service.publish({
      ...baseInput([finding()]),
      allowlistRaw: 'other/repo',
    });

    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(repository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ postMode: 'NOT_POSTED' }),
    );
    expect(outcome.notPosted).toBe(1);
    // **만들 때부터 종결이어야 한다.** 만든 뒤 따로 종결시키면 그 사이 실패한 행이
    // OPEN + NOT_POSTED 로 남고, 지문 중복 탓에 다시 손댈 수 없어 유령이 재생산된다.
    expect(repository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUPPRESSED' }),
    );
  });

  it('상한을 넘은 카드는 NOT_POSTED 로 저장하고 dropped 로 센다', async () => {
    github.createReviewComment.mockResolvedValue({
      commentId: '558',
      nodeId: 'PRRC_d',
    });

    const outcome = await service.publish({
      ...baseInput([
        finding({ body: 'a' }),
        finding({ body: 'b', severity: 'NICE_TO_HAVE' }),
      ]),
      max: 1,
    });

    expect(outcome.inline).toBe(1);
    expect(outcome.dropped).toBe(1);
    // 게이트가 떨군 카드는 종결로, 게시한 카드는 OPEN 으로 만들어져야 한다.
    expect(repository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUPPRESSED' }),
    );
    expect(repository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OPEN' }),
    );
  });

  it('지문이 이미 있으면(null) 게시하지 않는다', async () => {
    repository.createIfAbsent.mockResolvedValue(null);

    const outcome = await service.publish(baseInput([finding()]));

    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(outcome.duplicate).toBe(1);
  });

  it('markPosted 가 실패해도 게시 집계는 유지되고 일반 코멘트로 중복 게시되지 않는다', async () => {
    github.createReviewComment.mockResolvedValue({
      commentId: '600',
      nodeId: 'PRRC_e',
    });
    repository.markPosted.mockRejectedValueOnce(new Error('DB timeout'));

    const outcome = await service.publish(baseInput([finding()]));

    expect(outcome.inline).toBe(1);
    expect(github.addIssueComment).not.toHaveBeenCalled();
  });

  it('PR 전체 의견 게시 중 카드 하나의 markPosted 가 실패해도 카운터 합은 입력과 일치한다', async () => {
    github.createReviewComment.mockRejectedValue(new Error('422'));
    github.addIssueComment.mockResolvedValue(undefined);
    repository.markPosted
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValueOnce(undefined);

    const findings = [
      finding({ body: 'a' }),
      finding({ body: 'b' }),
      finding({ body: 'c' }),
    ];
    const outcome = await service.publish(baseInput(findings));

    expect(github.addIssueComment).toHaveBeenCalledTimes(1);
    expect(outcome.issueComment).toBe(3);
    const total = Object.values(outcome).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(findings.length);
  });

  it('카드 일부만 게시에 실패해도 성공분은 인라인, 실패분은 PR 전체 의견으로 격리된다', async () => {
    github.createReviewComment
      .mockResolvedValueOnce({ commentId: '700', nodeId: 'PRRC_f' })
      .mockRejectedValueOnce(new Error('422'))
      .mockRejectedValueOnce(new Error('422'));
    github.addIssueComment.mockResolvedValue(undefined);

    const findings = [finding({ body: 'ok' }), finding({ body: 'fail' })];
    const outcome = await service.publish(baseInput(findings));

    expect(outcome.inline).toBe(1);
    expect(outcome.issueComment).toBe(1);
    const total = Object.values(outcome).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(findings.length);
  });
});

describe('PublishFindingsService.upsertRiskMap', () => {
  const OWNER = 'JSL107';
  const TAGGED = `${IDAERI_REVIEW_MARKER} · 위험 지도\n\n예전 본문\n${RISK_MAP_COMMENT_TAG}`;
  let github: jest.Mocked<
    Pick<
      GithubClientPort,
      | 'addIssueComment'
      | 'getPullRequestHeadSha'
      | 'listIssueComments'
      | 'updateIssueComment'
    >
  >;
  let service: PublishFindingsService;
  const serviceWith = (ownerLogin: string | undefined) =>
    new PublishFindingsService(
      github as unknown as GithubClientPort,
      {} as PrReviewFindingRepositoryPort,
      buildWriters({
        owner: github,
        env: { GITHUB_WEBHOOK_OWNER_LOGIN: ownerLogin },
      }),
    );

  type Input = Parameters<PublishFindingsService['upsertRiskMap']>[0];
  const input = (overrides: Partial<Input> = {}): Input => ({
    repo: 'JSL107/personal_agents',
    pullNumber: 180,
    detail: {
      headSha: 'head-b',
      changedFiles: ['src/foo.service.ts'],
      changedFilesTruncated: false,
      changedFilesTotalCount: 1,
      changedLinesByFile: { 'src/foo.service.ts': 2 },
      changedFileStatsByFile: {
        'src/foo.service.ts': { status: 'modified', deletions: 0 },
      },
    } as unknown as PullRequestDetail,
    diff: { diff: DIFF, truncated: false, bytes: Buffer.byteLength(DIFF) },
    findings: [],
    dryRun: false,
    allowlistRaw: 'JSL107/personal_agents',
    ...overrides,
  });

  beforeEach(() => {
    github = {
      addIssueComment: jest.fn().mockResolvedValue(undefined),
      getPullRequestHeadSha: jest.fn().mockResolvedValue('head-b'),
      listIssueComments: jest.fn().mockResolvedValue([]),
      updateIssueComment: jest.fn().mockResolvedValue(undefined),
    };
    service = serviceWith(OWNER);
  });

  it('기존 위험 지도가 없으면 새 코멘트를 단다', async () => {
    await service.upsertRiskMap(input());

    expect(github.addIssueComment).toHaveBeenCalledWith({
      repo: 'JSL107/personal_agents',
      number: 180,
      body: expect.stringContaining(RISK_MAP_COMMENT_TAG),
    });
    expect(github.updateIssueComment).not.toHaveBeenCalled();
  });

  it('봇 계정이 쓴 위험 지도가 있으면 그 코멘트를 고쳐 쓴다', async () => {
    github.listIssueComments.mockResolvedValue([
      { id: 11, body: '사람이 단 코멘트', authorLogin: 'someone' },
      { id: 22, body: TAGGED, authorLogin: OWNER },
    ]);

    await service.upsertRiskMap(input());

    expect(github.updateIssueComment).toHaveBeenCalledWith({
      repo: 'JSL107/personal_agents',
      commentId: 22,
      body: expect.stringContaining('위험 점수'),
    });
    expect(github.addIssueComment).not.toHaveBeenCalled();
  });

  it('본문이 같으면 고치지 않는다', async () => {
    await service.upsertRiskMap(input());
    const [{ body }] = github.addIssueComment.mock.calls[0];
    github.addIssueComment.mockClear();
    github.listIssueComments.mockResolvedValue([
      { id: 22, body, authorLogin: OWNER },
    ]);

    await service.upsertRiskMap(input());

    expect(github.updateIssueComment).not.toHaveBeenCalled();
    expect(github.addIssueComment).not.toHaveBeenCalled();
  });

  it('표식을 흉내 낸 남의 코멘트는 고치지 않고 자기 코멘트를 새로 단다', async () => {
    github.listIssueComments.mockResolvedValue([
      { id: 33, body: TAGGED, authorLogin: 'someone' },
      { id: 34, body: `인용: ${RISK_MAP_COMMENT_TAG}`, authorLogin: OWNER },
    ]);

    await service.upsertRiskMap(input());

    expect(github.updateIssueComment).not.toHaveBeenCalled();
    expect(github.addIssueComment).toHaveBeenCalledTimes(1);
  });

  it('봇 계정을 모르면 표식만으로 찾는다', async () => {
    github.listIssueComments.mockResolvedValue([
      { id: 22, body: TAGGED, authorLogin: 'whoever' },
    ]);

    service = serviceWith(undefined);
    await service.upsertRiskMap(input());

    expect(github.updateIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 22 }),
    );
  });

  it('봇 계정 비교는 대소문자를 무시한다', async () => {
    github.listIssueComments.mockResolvedValue([
      { id: 22, body: TAGGED, authorLogin: 'jsl107' },
    ]);

    service = serviceWith('JSL107');
    await service.upsertRiskMap(input());

    expect(github.updateIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 22 }),
    );
    expect(github.addIssueComment).not.toHaveBeenCalled();
  });

  it.each(['', '   '])(
    '봇 계정이 빈 값(%j)이면 표식만으로 기존 코멘트를 찾는다',
    async (ownerLogin) => {
      github.listIssueComments.mockResolvedValue([
        { id: 22, body: TAGGED, authorLogin: OWNER },
      ]);

      service = serviceWith(ownerLogin);
      await service.upsertRiskMap(input());

      expect(github.updateIssueComment).toHaveBeenCalledWith(
        expect.objectContaining({ commentId: 22 }),
      );
      expect(github.addIssueComment).not.toHaveBeenCalled();
    },
  );

  it('리뷰한 커밋이 최신 head 가 아니면 쓰지 않는다', async () => {
    github.getPullRequestHeadSha.mockResolvedValue('head-c');

    await service.upsertRiskMap(input());

    expect(github.listIssueComments).not.toHaveBeenCalled();
    expect(github.addIssueComment).not.toHaveBeenCalled();
  });

  it('옛 커밋의 리뷰가 늦게 끝나도 최신 커밋의 지도를 덮어쓰지 않는다', async () => {
    const posted: { id: number; body: string; authorLogin: string }[] = [];
    github.listIssueComments.mockImplementation(async () => [...posted]);
    github.addIssueComment.mockImplementation(async ({ body }) => {
      posted.push({ id: 1, body, authorLogin: OWNER });
    });
    github.updateIssueComment.mockImplementation(async ({ body }) => {
      posted[0] = { ...posted[0], body };
    });
    const latest = input({ findings: [finding()] });
    const stale = input({
      detail: { ...latest.detail, headSha: 'head-a' } as PullRequestDetail,
    });

    await service.upsertRiskMap(latest);
    const latestBody = posted[0].body;
    await service.upsertRiskMap(stale);

    expect(posted).toHaveLength(1);
    expect(posted[0].body).toBe(latestBody);
  });

  it('같은 PR 을 동시에 갱신해도 코멘트는 하나다', async () => {
    const posted: { id: number; body: string; authorLogin: string }[] = [];
    github.listIssueComments.mockImplementation(async () => [...posted]);
    github.addIssueComment.mockImplementation(async ({ body }) => {
      posted.push({ id: posted.length + 1, body, authorLogin: OWNER });
    });

    await Promise.all([
      service.upsertRiskMap(input()),
      service.upsertRiskMap(input({ findings: [finding()] })),
    ]);

    expect(github.addIssueComment).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(1);
  });

  it.each([
    ['연습 모드', { dryRun: true }],
    ['허용 목록 밖', { allowlistRaw: 'someone/else' }],
  ])('%s 이면 GitHub 에 아무것도 남기지 않는다', async (_, overrides) => {
    await service.upsertRiskMap(input(overrides));

    expect(github.listIssueComments).not.toHaveBeenCalled();
    expect(github.addIssueComment).not.toHaveBeenCalled();
  });

  it('계산이 실패해도 예외를 올리지 않는다 — 스윕의 카드 게시를 막지 않게', async () => {
    await expect(
      service.upsertRiskMap(input({ detail: {} as PullRequestDetail })),
    ).resolves.toBeUndefined();
    expect(github.addIssueComment).not.toHaveBeenCalled();
  });

  it('조회가 실패해도 예외를 올리지 않는다 — 리뷰 결과를 바꾸지 않는 안내다', async () => {
    github.listIssueComments.mockRejectedValue(new Error('403'));

    await expect(service.upsertRiskMap(input())).resolves.toBeUndefined();
    expect(github.addIssueComment).not.toHaveBeenCalled();
  });
});

describe('PublishFindingsService — 봇 계정 분리', () => {
  const TAGGED = `${IDAERI_REVIEW_MARKER} · 위험 지도\n\n예전 본문\n${RISK_MAP_COMMENT_TAG}`;
  const buildClient = () => ({
    createReviewComment: jest
      .fn()
      .mockResolvedValue({ commentId: '1', nodeId: 'PRRC_1' }),
    addIssueComment: jest.fn().mockResolvedValue(undefined),
    getPullRequestHeadSha: jest.fn().mockResolvedValue('head-b'),
    listIssueComments: jest.fn().mockResolvedValue([]),
    updateIssueComment: jest.fn().mockResolvedValue(undefined),
  });
  let owner: ReturnType<typeof buildClient>;
  let bot: ReturnType<typeof buildClient>;
  let repository: ReturnType<typeof buildRepository>;
  let service: PublishFindingsService;

  const riskMapInput = (): Parameters<
    PublishFindingsService['upsertRiskMap']
  >[0] => ({
    repo: 'JSL107/personal_agents',
    pullNumber: 180,
    detail: {
      headSha: 'head-b',
      changedFiles: ['src/foo.service.ts'],
      changedFilesTruncated: false,
      changedFilesTotalCount: 1,
      changedLinesByFile: { 'src/foo.service.ts': 2 },
      changedFileStatsByFile: {
        'src/foo.service.ts': { status: 'modified', deletions: 0 },
      },
    } as unknown as PullRequestDetail,
    diff: { diff: DIFF, truncated: false, bytes: Buffer.byteLength(DIFF) },
    findings: [],
    dryRun: false,
    allowlistRaw: 'JSL107/personal_agents',
  });

  beforeEach(() => {
    owner = buildClient();
    bot = buildClient();
    repository = buildRepository();
    repository.createIfAbsent.mockImplementation(async (input) =>
      recordFrom(input),
    );
    service = new PublishFindingsService(
      owner as unknown as GithubClientPort,
      repository,
      buildWriters({ owner, bot, env: BOT_ENV }),
    );
  });

  it('인라인 지적은 봇 계정으로 단다', async () => {
    await service.publish(baseInput([finding()]));

    expect(bot.createReviewComment).toHaveBeenCalledTimes(1);
    expect(owner.createReviewComment).not.toHaveBeenCalled();
  });

  it('봇 게시가 실패하면 사용자 계정으로 돌아가지 않고 봇 계정으로 묶어 단다', async () => {
    bot.createReviewComment.mockRejectedValue(new Error('401'));

    await service.publish(baseInput([finding()]));

    expect(bot.addIssueComment).toHaveBeenCalledTimes(1);
    expect(owner.createReviewComment).not.toHaveBeenCalled();
    expect(owner.addIssueComment).not.toHaveBeenCalled();
  });

  it('위험 지도가 없으면 봇 계정으로 새로 단다', async () => {
    await service.upsertRiskMap(riskMapInput());

    expect(bot.addIssueComment).toHaveBeenCalledTimes(1);
    expect(owner.addIssueComment).not.toHaveBeenCalled();
  });

  it('전환 전에 사용자 계정이 단 위험 지도는 사용자 계정으로 고쳐 쓴다', async () => {
    owner.listIssueComments.mockResolvedValue([
      { id: 22, body: TAGGED, authorLogin: 'JSL107' },
    ]);

    await service.upsertRiskMap(riskMapInput());

    expect(owner.updateIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 22 }),
    );
    expect(bot.updateIssueComment).not.toHaveBeenCalled();
    expect(bot.addIssueComment).not.toHaveBeenCalled();
  });

  it('봇이 단 위험 지도가 있으면 사용자 계정 것보다 먼저 봇 계정으로 고쳐 쓴다', async () => {
    owner.listIssueComments.mockResolvedValue([
      { id: 22, body: TAGGED, authorLogin: 'JSL107' },
      { id: 33, body: TAGGED, authorLogin: 'idaeri-bot' },
    ]);

    await service.upsertRiskMap(riskMapInput());

    expect(bot.updateIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 33 }),
    );
    expect(owner.updateIssueComment).not.toHaveBeenCalled();
  });
});
