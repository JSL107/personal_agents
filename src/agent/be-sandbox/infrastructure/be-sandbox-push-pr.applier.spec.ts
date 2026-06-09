import { ConfigService } from '@nestjs/config';

import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { PreviewActionException } from '../../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../../preview-gate/domain/preview-action-error-code.enum';
import { BeSandboxPushPrPayload } from '../domain/be-sandbox-push-pr.type';

// applyDiffAndReadFiles 가 호스트 git 을 호출하므로 module 레벨 mock.
jest.mock('./be-sandbox-diff-apply.helper', () => ({
  applyDiffAndReadFiles: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
import { applyDiffAndReadFiles } from './be-sandbox-diff-apply.helper';
import { BeSandboxPushPrApplier } from './be-sandbox-push-pr.applier';

const mockApplyDiff = applyDiffAndReadFiles as jest.MockedFunction<
  typeof applyDiffAndReadFiles
>;

const buildPreview = (payload?: unknown): PreviewAction => ({
  id: 'preview-id-pushpr',
  slackUserId: 'U_USER',
  kind: PREVIEW_KIND.BE_SANDBOX_PUSH_PR,
  payload:
    payload ??
    ({
      diff: `--- a/src/foo/foo.ts
+++ b/src/foo/foo.ts
@@ -1,1 +1,1 @@
-old
+new`,
      reasoning: 'foo 한 줄 변경',
      changedFiles: ['src/foo/foo.ts'],
      repoLabel: 'JSL107/personal_agents',
      baseBranch: 'main',
    } satisfies BeSandboxPushPrPayload),
  status: PREVIEW_STATUS.PENDING,
  previewText: 'mock preview',
  responseUrl: null,
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  createdAt: new Date(),
  appliedAt: null,
  cancelledAt: null,
});

const buildApplier = (overrides?: {
  githubClient?: jest.Mocked<GithubClientPort>;
  configGet?: jest.Mock;
}) => {
  const githubClient =
    overrides?.githubClient ??
    ({
      pushBranchAndOpenPr: jest.fn(),
    } as unknown as jest.Mocked<GithubClientPort>);
  const configGet =
    overrides?.configGet ?? jest.fn().mockReturnValue(undefined);
  const applier = new BeSandboxPushPrApplier(githubClient, {
    get: configGet,
  } as unknown as ConfigService);
  return { applier, githubClient, configGet };
};

describe('BeSandboxPushPrApplier — Phase 2b-2 실제 PR open', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('kind 는 PREVIEW_KIND.BE_SANDBOX_PUSH_PR', () => {
    const { applier } = buildApplier();
    expect(applier.kind).toBe(PREVIEW_KIND.BE_SANDBOX_PUSH_PR);
  });

  it('정상 흐름 — diff apply + octokit push + PR url 응답', async () => {
    const { applier, githubClient, configGet } = buildApplier();
    configGet.mockImplementation((key: string) =>
      key === 'BE_SANDBOX_HOST_REPO_PATH' ? '/custom/host/repo' : undefined,
    );
    mockApplyDiff.mockResolvedValue(
      new Map([['src/foo/foo.ts', 'new content']]),
    );
    githubClient.pushBranchAndOpenPr.mockResolvedValue({
      prUrl: 'https://github.com/JSL107/personal_agents/pull/100',
      prNumber: 100,
      branchRef: 'refs/heads/feat/idaeri-foo-1717000000000',
      commitSha: 'abc1234567890def',
    });

    const result = await applier.apply(buildPreview());

    expect(mockApplyDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        hostRepoPath: '/custom/host/repo',
        changedFiles: ['src/foo/foo.ts'],
      }),
    );
    expect(githubClient.pushBranchAndOpenPr).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'JSL107/personal_agents',
        baseBranch: 'main',
        branchName: expect.stringMatching(/^feat\/idaeri-foo-\d+$/),
        commitMessage: expect.stringContaining('feat(idaeri):'),
        files: [{ path: 'src/foo/foo.ts', content: 'new content' }],
        prTitle: expect.any(String),
        prBody: expect.stringContaining('자동 생성 — 이대리'),
      }),
    );
    expect(result.message).toContain('Phase 2b-2 완료');
    expect(result.message).toContain('#100');
    expect(result.message).toContain('JSL107/personal_agents');
    expect(result.message).toContain('abc123456789');
    // 레버 3b: 열린 PR 을 ResultVerifier 가 재조회 검증하도록 artifact 로 노출.
    expect(result.artifacts).toEqual([
      { type: 'github_pr', repo: 'JSL107/personal_agents', prNumber: 100 },
    ]);
  });

  it('payload 형식 불일치 → PreviewActionException + apply diff skip', async () => {
    const { applier, githubClient } = buildApplier();
    await expect(
      applier.apply(buildPreview({ 잘못된: '형식' })),
    ).rejects.toBeInstanceOf(PreviewActionException);
    expect(mockApplyDiff).not.toHaveBeenCalled();
    expect(githubClient.pushBranchAndOpenPr).not.toHaveBeenCalled();
  });

  it('repoLabel "owner/repo" 형식 아니면 거절', async () => {
    const { applier, githubClient } = buildApplier();
    await expect(
      applier.apply(
        buildPreview({
          diff: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b',
          reasoning: 'r',
          changedFiles: ['x'],
          repoLabel: 'invalid_no_slash',
          baseBranch: 'main',
        }),
      ),
    ).rejects.toBeInstanceOf(PreviewActionException);
    expect(githubClient.pushBranchAndOpenPr).not.toHaveBeenCalled();
  });

  it('applyDiffAndReadFiles 실패 → PreviewActionException 으로 wrap', async () => {
    const { applier, githubClient } = buildApplier();
    mockApplyDiff.mockRejectedValue(
      new Error('git apply: patch does not match'),
    );
    await expect(applier.apply(buildPreview())).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
    });
    expect(githubClient.pushBranchAndOpenPr).not.toHaveBeenCalled();
  });

  it('octokit pushBranchAndOpenPr 실패 → PreviewActionException 으로 wrap', async () => {
    const { applier, githubClient } = buildApplier();
    mockApplyDiff.mockResolvedValue(
      new Map([['src/foo/foo.ts', 'new content']]),
    );
    githubClient.pushBranchAndOpenPr.mockRejectedValue(
      new Error('GitHub 422: reference already exists'),
    );
    await expect(applier.apply(buildPreview())).rejects.toBeInstanceOf(
      PreviewActionException,
    );
  });

  it('BE_SANDBOX_HOST_REPO_PATH 미설정 → process.cwd() 사용', async () => {
    const { applier, githubClient } = buildApplier();
    mockApplyDiff.mockResolvedValue(
      new Map([['src/foo/foo.ts', 'new content']]),
    );
    githubClient.pushBranchAndOpenPr.mockResolvedValue({
      prUrl: 'https://github.com/x/y/pull/1',
      prNumber: 1,
      branchRef: 'refs/heads/feat/idaeri-foo-1',
      commitSha: 'sha',
    });

    await applier.apply(buildPreview());
    expect(mockApplyDiff).toHaveBeenCalledWith(
      expect.objectContaining({ hostRepoPath: process.cwd() }),
    );
  });
});
