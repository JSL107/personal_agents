import { ReviewFinding } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { PrReviewFindingRepositoryPort } from '../domain/port/pr-review-finding.repository.port';
import { PublishFindingsService } from './publish-findings.service';

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
  }) as unknown as jest.Mocked<
    Pick<GithubClientPort, 'createReviewComment' | 'addIssueComment'>
  >;

const buildRepository = () =>
  ({
    createIfAbsent: jest.fn(),
    hasAnyForPullRequest: jest.fn(),
    markPosted: jest.fn(),
  }) as unknown as jest.Mocked<PrReviewFindingRepositoryPort>;

const baseInput = (findings: ReviewFinding[]) => ({
  agentRunId: 7,
  repo: 'JSL107/personal_agents',
  pullNumber: 180,
  headSha: 'abc1234',
  diff: DIFF,
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
    repository.createIfAbsent.mockImplementation(async (input) => ({
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
      createdAt: new Date(),
    }));
    service = new PublishFindingsService(
      github as unknown as GithubClientPort,
      repository,
    );
  });

  it('diff 범위 안의 줄은 인라인으로 게시한다', async () => {
    github.createReviewComment.mockResolvedValue({
      commentId: '555',
      nodeId: 'PRRC_a',
    });

    const outcome = await service.publish(baseInput([finding()]));

    expect(github.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ line: 12, filePath: 'src/foo.service.ts' }),
    );
    expect(outcome.inline).toBe(1);
    expect(repository.markPosted).toHaveBeenCalledWith({
      id: 1,
      postMode: 'INLINE',
      githubCommentId: '555',
      githubThreadNodeId: 'PRRC_a',
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

  it('인라인·파일 게시가 모두 실패하면 남은 카드를 일반 코멘트로 묶어 올린다', async () => {
    github.createReviewComment.mockRejectedValue(new Error('422'));
    github.addIssueComment.mockResolvedValue(undefined);

    const outcome = await service.publish(baseInput([finding()]));

    expect(github.addIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'JSL107/personal_agents', number: 180 }),
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

  it('연습 모드에서는 GitHub 을 호출하지 않고 DRY_RUN 으로 기록한다', async () => {
    const outcome = await service.publish({
      ...baseInput([finding()]),
      dryRun: true,
    });

    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(github.addIssueComment).not.toHaveBeenCalled();
    expect(repository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ postMode: 'DRY_RUN' }),
    );
    expect(outcome.dryRun).toBe(1);
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
  });

  it('지문이 이미 있으면(null) 게시하지 않는다', async () => {
    repository.createIfAbsent.mockResolvedValue(null);

    const outcome = await service.publish(baseInput([finding()]));

    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(outcome.duplicate).toBe(1);
  });
});
