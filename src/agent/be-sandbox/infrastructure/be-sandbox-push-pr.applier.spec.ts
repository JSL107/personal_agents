import { PreviewActionException } from '../../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../../preview-gate/domain/preview-action-error-code.enum';
import { BeSandboxPushPrPayload } from '../domain/be-sandbox-push-pr.type';
import { BeSandboxPushPrApplier } from './be-sandbox-push-pr.applier';

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
      reasoning: 'foo 1줄 변경',
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

describe('BeSandboxPushPrApplier — Phase 2b-1 scaffold', () => {
  const applier = new BeSandboxPushPrApplier();

  it('kind 는 PREVIEW_KIND.BE_SANDBOX_PUSH_PR', () => {
    expect(applier.kind).toBe(PREVIEW_KIND.BE_SANDBOX_PUSH_PR);
  });

  it('정상 payload — repo / base / 파일 수 / diff snippet 응답에 포함', async () => {
    const result = await applier.apply(buildPreview());
    expect(result).toContain('Phase 2b-1 scaffold');
    expect(result).toContain('JSL107/personal_agents');
    expect(result).toContain('main');
    expect(result).toContain('src/foo/foo.ts');
    expect(result).toContain('foo 1줄 변경');
    expect(result).toContain('octokit');
  });

  it('payload 형식 불일치 → PreviewActionException', async () => {
    await expect(
      applier.apply(buildPreview({ 잘못된: '형식' })),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
    });
  });

  it('repoLabel 이 "owner/repo" 형식 아니면 거절', async () => {
    await expect(
      applier.apply(
        buildPreview({
          diff: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b',
          reasoning: 'r',
          changedFiles: ['x'],
          repoLabel: 'bad_format_no_slash',
          baseBranch: 'main',
        }),
      ),
    ).rejects.toBeInstanceOf(PreviewActionException);
  });

  it('changedFiles 가 빈 배열이면 거절', async () => {
    await expect(
      applier.apply(
        buildPreview({
          diff: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b',
          reasoning: 'r',
          changedFiles: [],
          repoLabel: 'foo/bar',
          baseBranch: 'main',
        }),
      ),
    ).rejects.toBeInstanceOf(PreviewActionException);
  });
});
