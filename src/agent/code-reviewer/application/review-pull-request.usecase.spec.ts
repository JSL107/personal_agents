import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { CodeReviewerException } from '../domain/code-reviewer.exception';
import { PullRequestReview } from '../domain/code-reviewer.type';
import { CodeReviewerErrorCode } from '../domain/code-reviewer-error-code.enum';
import {
  buildReviewPrompt,
  ReviewPullRequestUsecase,
} from './review-pull-request.usecase';

describe('ReviewPullRequestUsecase', () => {
  const validReview: PullRequestReview = {
    summary: '리뷰 초안',
    riskLevel: 'low',
    mustFix: [],
    niceToHave: ['주석 보강'],
    missingTests: [],
    reviewCommentDrafts: [{ body: 'LGTM' }],
    approvalRecommendation: 'comment',
    // niceToHave 가 비어 있지 않으므로, findings 를 []로 두면 파서의 legacy 폴백이
    // 이 값에서 파생시켜 round-trip(toEqual) 이 깨진다 — 파생 결과와 미리 일치시킨다.
    findings: [
      { category: 'UNCLASSIFIED', severity: 'NICE_TO_HAVE', body: '주석 보강' },
    ],
  };

  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let githubClient: jest.Mocked<GithubClientPort>;
  let usecase: ReviewPullRequestUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 55 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 55,
      };
    });
    githubClient = {
      listMyAssignedTasks: jest.fn(),
      getPullRequest: jest.fn(),
      getPullRequestDiff: jest.fn(),
      compareCommits: jest.fn(),
      addIssueComment: jest.fn(),
      listAuthorMergedPullRequestsSince: jest.fn(),
      listAuthorOpenPullRequests: jest.fn(),
      listRepoLabels: jest.fn(),
      addLabelsToIssue: jest.fn(),
      pushBranchAndOpenPr: jest.fn(),
      fetchPullRequestEngagement: jest.fn(),
      createReviewComment: jest.fn(),
      listReviewThreads: jest.fn(),
      resolveReviewThread: jest.fn(),
    };
    const outcomeRepoMock = {
      save: jest.fn(),
      findRecentRejected: jest.fn().mockResolvedValue([]),
    };

    usecase = new ReviewPullRequestUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      { execute: agentRunServiceExecute } as unknown as AgentRunService,
      githubClient,
      outcomeRepoMock as any,
    );

    githubClient.getPullRequest.mockResolvedValue({
      number: 34,
      title: 'feat: foo',
      body: 'body',
      repo: 'foo/bar',
      url: 'https://github.com/foo/bar/pull/34',
      baseRef: 'main',
      headRef: 'feature/foo',
      authorLogin: 'octocat',
      changedFiles: ['src/a.ts'],
      changedFilesTotalCount: 1,
      changedFilesTruncated: false,
      additions: 10,
      deletions: 2,
      headSha: 'sha',
    });
    githubClient.getPullRequestDiff.mockResolvedValue({
      diff: 'diff --git a/src/a.ts ...',
      truncated: false,
      bytes: 30,
    });
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validReview),
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    } satisfies CompletionResponse);
  });

  it('PR URL 파싱 → GitHub fetch → Claude 호출 → 리뷰 반환 전체 경로', async () => {
    const result = await usecase.execute({
      prRef: 'https://github.com/foo/bar/pull/34',
      slackUserId: 'U123',
    });

    expect(result.result).toEqual(validReview);
    expect(result.modelUsed).toBe('claude-cli');
    expect(result.agentRunId).toBe(55);
    expect(githubClient.getPullRequest).toHaveBeenCalledWith({
      repo: 'foo/bar',
      number: 34,
    });
    expect(githubClient.getPullRequestDiff).toHaveBeenCalledWith({
      repo: 'foo/bar',
      number: 34,
    });
    expect(modelRouter.route).toHaveBeenCalledWith({
      agentType: AgentType.CODE_REVIEWER,
      request: expect.objectContaining({
        systemPrompt: expect.any(String),
        prompt: expect.stringContaining('foo/bar'),
      }),
    });
  });

  it('snapshot 이 주입되면 GitHub 을 재조회하지 않고 그 스냅샷으로 리뷰한다', async () => {
    // 스윕은 게시(headSha·diff)에 쓸 스냅샷을 이미 조회한 상태다. 여기서 다시 조회하면
    // 그 사이 push 된 커밋 때문에 리뷰 기준과 게시 기준이 갈린다.
    const detail = {
      number: 34,
      title: 'feat: foo',
      body: 'body',
      repo: 'foo/bar',
      url: 'https://github.com/foo/bar/pull/34',
      baseRef: 'main',
      headRef: 'feature/foo',
      authorLogin: 'octocat',
      changedFiles: ['src/injected.ts'],
      changedFilesTotalCount: 1,
      changedFilesTruncated: false,
      additions: 1,
      deletions: 0,
      headSha: 'injected-sha',
    };

    await usecase.execute({
      prRef: 'foo/bar#34',
      slackUserId: 'U123',
      snapshot: {
        detail,
        diff: { diff: 'injected diff', truncated: false, bytes: 13 },
      },
    });

    expect(githubClient.getPullRequest).not.toHaveBeenCalled();
    expect(githubClient.getPullRequestDiff).not.toHaveBeenCalled();
    expect(modelRouter.route.mock.calls[0][0].request.prompt).toContain(
      'injected diff',
    );
  });

  it('dryRun 을 주면 inputSnapshot 에 남긴다 — 실게시 전환 시 재리뷰 판정 근거', async () => {
    await usecase.execute({
      prRef: 'foo/bar#34',
      slackUserId: 'U123',
      dryRun: true,
    });

    expect(agentRunServiceExecute.mock.calls[0][0].inputSnapshot).toEqual(
      expect.objectContaining({ dryRun: true }),
    );
  });

  it('dryRun 미지정(슬래시 경로)이면 inputSnapshot 에 키 자체가 없다', async () => {
    await usecase.execute({ prRef: 'foo/bar#34', slackUserId: 'U123' });

    expect(
      agentRunServiceExecute.mock.calls[0][0].inputSnapshot,
    ).not.toHaveProperty('dryRun');
  });

  it('잘못된 PR ref 는 INVALID_PR_REFERENCE 예외 (GitHub/모델 호출 안 함)', async () => {
    await expect(
      usecase.execute({ prRef: 'not a pr', slackUserId: 'U' }),
    ).rejects.toMatchObject({
      codeReviewerErrorCode: CodeReviewerErrorCode.INVALID_PR_REFERENCE,
    });

    expect(githubClient.getPullRequest).not.toHaveBeenCalled();
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('AgentRunService 에 CODE_REVIEWER / SLACK_COMMAND_REVIEW_PR + 입력 evidence 전달', async () => {
    await usecase.execute({
      prRef: 'foo/bar#7',
      slackUserId: 'U999',
    });

    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.CODE_REVIEWER);
    expect(call.triggerType).toBe('SLACK_COMMAND_REVIEW_PR');
    expect(call.inputSnapshot).toEqual({
      prRef: 'foo/bar#7',
      repo: 'foo/bar',
      pullNumber: 7,
      slackUserId: 'U999',
    });
    expect(call.evidence).toEqual([
      {
        sourceType: 'SLACK_COMMAND_REVIEW_PR',
        sourceId: 'U999',
        payload: { prRef: 'foo/bar#7' },
      },
    ]);
  });

  it('모델 응답이 PullRequestReview 스키마에 안 맞으면 INVALID_MODEL_OUTPUT 예외', async () => {
    modelRouter.route.mockResolvedValue({
      text: 'not a review',
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });

    await expect(
      usecase.execute({
        prRef: 'foo/bar#7',
        slackUserId: 'U',
      }),
    ).rejects.toBeInstanceOf(CodeReviewerException);
  });
});

describe('ReviewPullRequestUsecase — conversationContext', () => {
  const validReview: PullRequestReview = {
    summary: '리뷰 초안',
    riskLevel: 'low',
    mustFix: [],
    niceToHave: [],
    missingTests: [],
    reviewCommentDrafts: [],
    approvalRecommendation: 'approve',
    findings: [],
  };

  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let githubClient: jest.Mocked<GithubClientPort>;
  let usecase: ReviewPullRequestUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 99 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 99,
      };
    });
    githubClient = {
      listMyAssignedTasks: jest.fn(),
      getPullRequest: jest.fn(),
      getPullRequestDiff: jest.fn(),
      compareCommits: jest.fn(),
      addIssueComment: jest.fn(),
      listAuthorMergedPullRequestsSince: jest.fn(),
      listAuthorOpenPullRequests: jest.fn(),
      listRepoLabels: jest.fn(),
      addLabelsToIssue: jest.fn(),
      pushBranchAndOpenPr: jest.fn(),
      fetchPullRequestEngagement: jest.fn(),
      createReviewComment: jest.fn(),
      listReviewThreads: jest.fn(),
      resolveReviewThread: jest.fn(),
    };
    const outcomeRepoMock = {
      save: jest.fn(),
      findRecentRejected: jest.fn().mockResolvedValue([]),
    };

    usecase = new ReviewPullRequestUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      { execute: agentRunServiceExecute } as unknown as AgentRunService,
      githubClient,
      outcomeRepoMock as any,
    );

    githubClient.getPullRequest.mockResolvedValue({
      number: 7,
      title: 'feat: bar',
      body: '',
      repo: 'foo/bar',
      url: 'https://github.com/foo/bar/pull/7',
      baseRef: 'main',
      headRef: 'feature/bar',
      authorLogin: 'tester',
      changedFiles: ['src/x.ts'],
      changedFilesTotalCount: 1,
      changedFilesTruncated: false,
      additions: 1,
      deletions: 0,
      headSha: 'sha',
    });
    githubClient.getPullRequestDiff.mockResolvedValue({
      diff: '+const x = 1;',
      truncated: false,
      bytes: 14,
    });
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validReview),
      modelUsed: 'claude-cli',
      provider: 'CLAUDE',
    });
  });

  it('userInstruction 있으면 프롬프트 맨 앞에 [사용자 지시] 섹션이 삽입된다', async () => {
    await usecase.execute({
      prRef: 'foo/bar#7',
      slackUserId: 'U1',
      conversationContext: { userInstruction: '보안 취약점 위주로 봐줘' },
    });

    const call = modelRouter.route.mock.calls[0][0];
    const prompt: string = call.request.prompt;
    expect(prompt).toMatch(/^\[사용자 지시/);
    expect(prompt).toContain('보안 취약점 위주로 봐줘');
    // 사용자 지시 뒤에 기존 PR 메타 섹션이 나와야 함
    expect(prompt).toContain('[PR 메타]');
  });

  it('userInstruction 없으면 [사용자 지시] 섹션이 삽입되지 않는다 (회귀)', async () => {
    await usecase.execute({
      prRef: 'foo/bar#7',
      slackUserId: 'U1',
    });

    const call = modelRouter.route.mock.calls[0][0];
    const prompt: string = call.request.prompt;
    expect(prompt).not.toContain('[사용자 지시');
    expect(prompt).toMatch(/^\[PR 메타\]/);
  });

  it('conversationContext 자체가 undefined 이면 기존 동작 동일 (회귀)', async () => {
    await usecase.execute({
      prRef: 'foo/bar#7',
      slackUserId: 'U1',
      conversationContext: undefined,
    });

    const call = modelRouter.route.mock.calls[0][0];
    const prompt: string = call.request.prompt;
    expect(prompt).not.toContain('[사용자 지시');
  });

  // 실측 오탐: "PrReviewFinding 모델의 migration 파일이 없다" — 이 레포는 db push 방식이라
  // 마이그레이션 파일이 애초에 없다. 규약을 프롬프트에 실어 이 유형을 막는다.
  it('이 레포를 리뷰하면 프롬프트 끝에 [리뷰 대상 레포 규약] 섹션이 붙는다', async () => {
    githubClient.getPullRequest.mockResolvedValue({
      number: 189,
      title: 'feat: pr review loop',
      body: 'body',
      repo: 'JSL107/personal_agents',
      url: 'https://github.com/JSL107/personal_agents/pull/189',
      baseRef: 'main',
      headRef: 'feat/loop',
      authorLogin: 'JSL107',
      changedFiles: ['prisma/schema.prisma'],
      changedFilesTotalCount: 1,
      changedFilesTruncated: false,
      additions: 10,
      deletions: 2,
      headSha: 'sha',
    });

    await usecase.execute({
      prRef: 'JSL107/personal_agents#189',
      slackUserId: 'U1',
    });

    const prompt: string = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(prompt).toContain('[리뷰 대상 레포 규약');
    expect(prompt).toContain('Prisma 마이그레이션 파일을 만들지 않는다');
    // diff 를 다 읽은 뒤 읽히도록 diff 뒤에 와야 한다.
    expect(prompt.indexOf('[리뷰 대상 레포 규약')).toBeGreaterThan(
      prompt.indexOf('[diff]'),
    );
  });

  it('다른 레포를 리뷰하면 레포 규약이 붙지 않는다 (틀린 규약 전파 차단)', async () => {
    await usecase.execute({
      prRef: 'foo/bar#7',
      slackUserId: 'U1',
    });

    const prompt: string = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(prompt).not.toContain('[리뷰 대상 레포 규약');
  });
});

describe('buildReviewPrompt', () => {
  it('PR 메타 / changed files / diff 를 markdown 으로 결합', () => {
    const text = buildReviewPrompt({
      detail: {
        number: 1,
        title: 'feat: x',
        body: 'body text',
        repo: 'a/b',
        url: 'u',
        baseRef: 'main',
        headRef: 'feat',
        authorLogin: 'me',
        changedFiles: ['src/a.ts', 'src/b.ts'],
        changedFilesTotalCount: 2,
        changedFilesTruncated: false,
        additions: 5,
        deletions: 1,
        headSha: 'sha',
      },
      diff: { diff: '+hello', truncated: false, bytes: 6 },
    });

    expect(text).toContain('repo: a/b');
    expect(text).toContain('#1');
    expect(text).toContain('+5 / -1');
    expect(text).toContain('- src/a.ts');
    expect(text).toContain('+hello');
  });

  it('changedFilesTruncated 이면 (잘림: ...) 노트 포함', () => {
    const text = buildReviewPrompt({
      detail: {
        number: 1,
        title: 't',
        body: '',
        repo: 'a/b',
        url: 'u',
        baseRef: 'main',
        headRef: 'h',
        authorLogin: 'm',
        changedFiles: ['x.ts'],
        changedFilesTotalCount: 600,
        changedFilesTruncated: true,
        additions: 0,
        deletions: 0,
        headSha: 'sha',
      },
      diff: { diff: '', truncated: false, bytes: 0 },
    });
    expect(text).toContain('잘림: 전체 600개 중');
  });

  it('diff truncated 이면 노트 포함', () => {
    const text = buildReviewPrompt({
      detail: {
        number: 1,
        title: 't',
        body: '',
        repo: 'a/b',
        url: 'u',
        baseRef: 'main',
        headRef: 'h',
        authorLogin: 'm',
        changedFiles: [],
        changedFilesTotalCount: 0,
        changedFilesTruncated: false,
        additions: 0,
        deletions: 0,
        headSha: 'sha',
      },
      diff: { diff: 'short', truncated: true, bytes: 10000 },
    });
    expect(text).toContain('잘려서 전달됨');
  });
});

describe('ReviewPullRequestUsecase × episodic negative examples', () => {
  const validReview: PullRequestReview = {
    summary: 's',
    riskLevel: 'low',
    mustFix: [],
    niceToHave: [],
    missingTests: [],
    reviewCommentDrafts: [],
    approvalRecommendation: 'comment',
    findings: [],
  };

  const makeDeps = () => {
    const modelRouter = {
      route: jest.fn().mockResolvedValue({
        text: JSON.stringify(validReview),
        modelUsed: 'claude-cli',
        provider: ModelProviderName.CLAUDE,
      }),
    };
    const agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 1 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 1,
      };
    });
    const githubClient = {
      listMyAssignedTasks: jest.fn(),
      getPullRequest: jest.fn().mockResolvedValue({
        number: 1,
        title: 'feat: 결제 PG 연동',
        body: '',
        repo: 'foo/bar',
        url: 'u',
        baseRef: 'main',
        headRef: 'h',
        authorLogin: 'a',
        changedFiles: ['src/payment.ts'],
        changedFilesTotalCount: 1,
        changedFilesTruncated: false,
        additions: 1,
        deletions: 0,
        headSha: 'sha',
      }),
      getPullRequestDiff: jest
        .fn()
        .mockResolvedValue({ diff: '+x', truncated: false, bytes: 2 }),
      addIssueComment: jest.fn(),
      listAuthorMergedPullRequestsSince: jest.fn(),
      listAuthorOpenPullRequests: jest.fn(),
      listRepoLabels: jest.fn(),
      addLabelsToIssue: jest.fn(),
      pushBranchAndOpenPr: jest.fn(),
      fetchPullRequestEngagement: jest.fn(),
      createReviewComment: jest.fn(),
      listReviewThreads: jest.fn(),
      resolveReviewThread: jest.fn(),
    };
    const outcomeRepo = {
      save: jest.fn(),
      findRecentRejected: jest.fn().mockResolvedValue([]),
    };
    return { modelRouter, agentRunServiceExecute, githubClient, outcomeRepo };
  };

  it('episodic 주입 시 의미 유사 reject 를 negative example 로 주입', async () => {
    const deps = makeDeps();
    const episodic = {
      record: jest.fn(),
      searchRelevant: jest.fn().mockResolvedValue([
        {
          id: 1,
          agentRunId: 9,
          agentType: 'CODE_REVIEWER',
          content: 'any 쓰지 마세요',
          score: 0.9,
          occurredAt: new Date(),
        },
      ]),
    };
    const usecase = new ReviewPullRequestUsecase(
      deps.modelRouter as never,
      { execute: deps.agentRunServiceExecute } as never,
      deps.githubClient as never,
      deps.outcomeRepo as never,
      episodic as never,
    );

    await usecase.execute({ prRef: 'foo/bar#1', slackUserId: 'U1' });

    expect(episodic.searchRelevant).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'pr_review',
        agentType: 'CODE_REVIEWER',
        limit: 2,
      }),
    );
    const prompt = deps.modelRouter.route.mock.calls[0][0].request.prompt;
    expect(prompt).toContain('과거에 무시한 리뷰 패턴');
    expect(prompt).toContain('any 쓰지 마세요');
    expect(deps.outcomeRepo.findRecentRejected).not.toHaveBeenCalled();
  });

  it('episodic 미주입 시 recency(findRecentRejected) fallback', async () => {
    const deps = makeDeps();
    deps.outcomeRepo.findRecentRejected.mockResolvedValue([
      {
        id: 1,
        agentRunId: 9,
        slackUserId: 'U1',
        accepted: false,
        comment: 'console.log 금지',
        createdAt: new Date(),
      },
    ]);
    const usecase = new ReviewPullRequestUsecase(
      deps.modelRouter as never,
      { execute: deps.agentRunServiceExecute } as never,
      deps.githubClient as never,
      deps.outcomeRepo as never,
      undefined,
    );

    await usecase.execute({ prRef: 'foo/bar#1', slackUserId: 'U1' });

    expect(deps.outcomeRepo.findRecentRejected).toHaveBeenCalled();
    const prompt = deps.modelRouter.route.mock.calls[0][0].request.prompt;
    expect(prompt).toContain('console.log 금지');
  });

  it('episodic 검색 throw 시 recency fallback (best-effort)', async () => {
    const deps = makeDeps();
    deps.outcomeRepo.findRecentRejected.mockResolvedValue([
      {
        id: 1,
        agentRunId: 9,
        slackUserId: 'U1',
        accepted: false,
        comment: 'magic number 금지',
        createdAt: new Date(),
      },
    ]);
    const episodic = {
      record: jest.fn(),
      searchRelevant: jest.fn().mockRejectedValue(new Error('embed down')),
    };
    const usecase = new ReviewPullRequestUsecase(
      deps.modelRouter as never,
      { execute: deps.agentRunServiceExecute } as never,
      deps.githubClient as never,
      deps.outcomeRepo as never,
      episodic as never,
    );

    await usecase.execute({ prRef: 'foo/bar#1', slackUserId: 'U1' });

    expect(deps.outcomeRepo.findRecentRejected).toHaveBeenCalled();
    const prompt = deps.modelRouter.route.mock.calls[0][0].request.prompt;
    expect(prompt).toContain('magic number 금지');
  });
});
