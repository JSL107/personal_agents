import { ConfigService } from '@nestjs/config';

import { PreviewActionException } from '../../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../../preview-gate/domain/preview-action-error-code.enum';
import { RunSandboxUsecase } from '../../../sandbox/application/run-sandbox.usecase';
import { GenerateBeDiffUsecase } from '../../be-diff-generator/application/generate-be-diff.usecase';
import { BeDiffGeneratorException } from '../../be-diff-generator/domain/be-diff-generator.exception';
import { BeDiffGeneratorErrorCode } from '../../be-diff-generator/domain/be-diff-generator-error-code.enum';
import { BeSandboxApplyPayload } from '../domain/be-sandbox.type';
import { BeSandboxApplier } from './be-sandbox.applier';

const buildPreview = (
  overrides: Partial<PreviewAction> = {},
  payload?: unknown,
): PreviewAction => ({
  id: 'preview-id-1',
  slackUserId: 'U_USER',
  kind: PREVIEW_KIND.BE_SANDBOX_APPLY,
  payload:
    payload ??
    ({
      planText: '결제 검증 API 추가 plan body',
      repoLabel: 'JSL107/personal_agents',
      baseBranch: 'main',
    } satisfies BeSandboxApplyPayload),
  status: PREVIEW_STATUS.PENDING,
  previewText: 'mock preview',
  responseUrl: null,
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  createdAt: new Date(),
  appliedAt: null,
  cancelledAt: null,
  ...overrides,
});

const sampleDiff = `--- a/src/foo/foo.ts
+++ b/src/foo/foo.ts
@@ -1,3 +1,4 @@
 export const foo = () => {
-  return 1;
+  return 2;
+  // doubled
 };`;

const buildApplier = (overrides?: {
  generateBeDiffUsecase?: jest.Mocked<GenerateBeDiffUsecase>;
  runSandboxUsecase?: jest.Mocked<RunSandboxUsecase>;
  configGet?: jest.Mock;
}) => {
  const generateBeDiffUsecase =
    overrides?.generateBeDiffUsecase ??
    ({ execute: jest.fn() } as unknown as jest.Mocked<GenerateBeDiffUsecase>);
  const runSandboxUsecase =
    overrides?.runSandboxUsecase ??
    ({ execute: jest.fn() } as unknown as jest.Mocked<RunSandboxUsecase>);
  const configGet =
    overrides?.configGet ?? jest.fn().mockReturnValue(undefined);
  const applier = new BeSandboxApplier(
    generateBeDiffUsecase,
    runSandboxUsecase,
    { get: configGet } as unknown as ConfigService,
  );
  return { applier, generateBeDiffUsecase, runSandboxUsecase, configGet };
};

describe('BeSandboxApplier — Phase 2a-3 git apply --check', () => {
  it('kind 는 PREVIEW_KIND.BE_SANDBOX_APPLY', () => {
    const { applier } = buildApplier();
    expect(applier.kind).toBe(PREVIEW_KIND.BE_SANDBOX_APPLY);
  });

  it('정상 payload — diff 합성 → sandbox git apply --check 통과 → 성공 응답', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase, configGet } =
      buildApplier();
    configGet.mockImplementation((key: string) =>
      key === 'BE_SANDBOX_HOST_REPO_PATH' ? '/custom/host/repo' : undefined,
    );
    generateBeDiffUsecase.execute.mockResolvedValue({
      diff: sampleDiff,
      reasoning: 'foo 반환을 2로',
      changedFiles: ['src/foo/foo.ts'],
    });
    runSandboxUsecase.execute.mockResolvedValue({
      exitCode: 0,
      stdout: 'PATCH_APPLY_CHECK_OK',
      stderr: '',
      durationMs: 1500,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const result = await applier.apply(buildPreview());

    expect(runSandboxUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        hostMountPath: '/custom/host/repo',
        mountMode: 'ro',
        networkMode: 'none',
        tmpfsFiles: [
          { containerPath: '/work/patch.diff', content: sampleDiff },
        ],
      }),
    );
    expect(result).toContain('Phase 2a-3');
    expect(result).toContain('✅ `git apply --check` 통과');
    expect(result).toContain('/custom/host/repo');
    expect(result).toContain('@@ -1,3 +1,4 @@');
  });

  it('BE_SANDBOX_HOST_REPO_PATH 미설정 → process.cwd() 사용', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue({
      diff: sampleDiff,
      reasoning: 'r',
      changedFiles: ['src/foo/foo.ts'],
    });
    runSandboxUsecase.execute.mockResolvedValue({
      exitCode: 0,
      stdout: 'PATCH_APPLY_CHECK_OK',
      stderr: '',
      durationMs: 1500,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    await applier.apply(buildPreview());
    expect(runSandboxUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ hostMountPath: process.cwd() }),
    );
  });

  it('sandbox exit 비-0 → ❌ apply --check 실패 + stderr 노출', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue({
      diff: sampleDiff,
      reasoning: 'r',
      changedFiles: ['src/foo/foo.ts'],
    });
    runSandboxUsecase.execute.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'error: patch failed: src/foo/foo.ts:1',
      durationMs: 800,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const result = await applier.apply(buildPreview());
    expect(result).toContain('❌ `git apply --check` 실패');
    expect(result).toContain('exit=1');
    expect(result).toContain('error: patch failed');
  });

  it('sandbox exit 0 + sentinel 누락 → 실패 처리 (불완전 stdout 안전망)', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue({
      diff: sampleDiff,
      reasoning: 'r',
      changedFiles: ['src/foo/foo.ts'],
    });
    runSandboxUsecase.execute.mockResolvedValue({
      exitCode: 0,
      stdout: 'partial output without sentinel',
      stderr: '',
      durationMs: 800,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const result = await applier.apply(buildPreview());
    expect(result).toContain('❌ `git apply --check` 실패');
  });

  it('sandbox timedOut=true → ❌ (timed out) 표시', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue({
      diff: sampleDiff,
      reasoning: 'r',
      changedFiles: ['src/foo/foo.ts'],
    });
    runSandboxUsecase.execute.mockResolvedValue({
      exitCode: 137,
      stdout: '',
      stderr: '',
      durationMs: 30_000,
      timedOut: true,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const result = await applier.apply(buildPreview());
    expect(result).toContain('timed out');
  });

  it('payload 형식 불일치 → PreviewActionException + diff 합성도 skip', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    await expect(
      applier.apply(buildPreview({}, { 잘못된: '형식' })),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
    });
    expect(generateBeDiffUsecase.execute).not.toHaveBeenCalled();
    expect(runSandboxUsecase.execute).not.toHaveBeenCalled();
  });

  it('GenerateBeDiff 가 INVALID_DIFF_FORMAT throw → 그대로 전파 (sandbox skip)', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    generateBeDiffUsecase.execute.mockRejectedValue(
      new BeDiffGeneratorException({
        code: BeDiffGeneratorErrorCode.INVALID_DIFF_FORMAT,
        message: 'unsafe path',
      }),
    );

    await expect(applier.apply(buildPreview())).rejects.toMatchObject({
      beDiffGeneratorErrorCode: BeDiffGeneratorErrorCode.INVALID_DIFF_FORMAT,
    });
    expect(runSandboxUsecase.execute).not.toHaveBeenCalled();
  });
});
