import { PreviewActionException } from '../../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../../preview-gate/domain/preview-action-error-code.enum';
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

describe('BeSandboxApplier', () => {
  const generateBeDiffUsecase = {
    execute: jest.fn(),
  } as unknown as jest.Mocked<GenerateBeDiffUsecase>;

  const applier = new BeSandboxApplier(generateBeDiffUsecase);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('kind 는 PREVIEW_KIND.BE_SANDBOX_APPLY', () => {
    expect(applier.kind).toBe(PREVIEW_KIND.BE_SANDBOX_APPLY);
  });

  it('정상 payload — GenerateBeDiffUsecase 호출 + diff 응답에 포함', async () => {
    generateBeDiffUsecase.execute.mockResolvedValue({
      diff: sampleDiff,
      reasoning: 'foo 반환을 2로',
      changedFiles: ['src/foo/foo.ts'],
    });

    const result = await applier.apply(buildPreview());

    expect(generateBeDiffUsecase.execute).toHaveBeenCalledWith({
      planText: '결제 검증 API 추가 plan body',
      repoLabel: 'JSL107/personal_agents',
      baseBranch: 'main',
    });
    expect(result).toContain('Phase 2a-2');
    expect(result).toContain('JSL107/personal_agents');
    expect(result).toContain('main');
    expect(result).toContain('src/foo/foo.ts');
    expect(result).toContain('foo 반환을 2로');
    expect(result).toContain('@@ -1,3 +1,4 @@');
  });

  it('payload 형식 불일치 → PreviewActionException', async () => {
    await expect(
      applier.apply(buildPreview({}, { 잘못된: '형식' })),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
    });
    expect(generateBeDiffUsecase.execute).not.toHaveBeenCalled();
  });

  it('GenerateBeDiff 가 INVALID_DIFF_FORMAT throw → 그대로 전파', async () => {
    generateBeDiffUsecase.execute.mockRejectedValue(
      new BeDiffGeneratorException({
        code: BeDiffGeneratorErrorCode.INVALID_DIFF_FORMAT,
        message: 'unsafe path',
      }),
    );

    await expect(applier.apply(buildPreview())).rejects.toMatchObject({
      beDiffGeneratorErrorCode: BeDiffGeneratorErrorCode.INVALID_DIFF_FORMAT,
    });
  });

  it('diff 가 cap 초과 시 잘린 채로 응답 (생략 표시)', async () => {
    const longDiff =
      '--- a/foo.ts\n+++ b/foo.ts\n@@ -1,1 +1,1 @@\n-old\n+' +
      'A'.repeat(15_000);
    generateBeDiffUsecase.execute.mockResolvedValue({
      diff: longDiff,
      reasoning: 'r',
      changedFiles: ['foo.ts'],
    });

    const result = await applier.apply(buildPreview());
    expect(result).toContain('생략됨 — diff cap');
  });
});
