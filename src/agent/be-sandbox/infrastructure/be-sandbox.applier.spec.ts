import { ConfigService } from '@nestjs/config';

import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
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
  slackChannelId: null,
  slackMessageTs: null,
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
  createPreviewUsecase?: jest.Mocked<CreatePreviewUsecase>;
}) => {
  const generateBeDiffUsecase =
    overrides?.generateBeDiffUsecase ??
    ({ execute: jest.fn() } as unknown as jest.Mocked<GenerateBeDiffUsecase>);
  const runSandboxUsecase =
    overrides?.runSandboxUsecase ??
    ({ execute: jest.fn() } as unknown as jest.Mocked<RunSandboxUsecase>);
  const configGet =
    overrides?.configGet ?? jest.fn().mockReturnValue(undefined);
  const createPreviewUsecase =
    overrides?.createPreviewUsecase ??
    ({
      execute: jest.fn().mockResolvedValue({
        id: 'next-preview-id',
        slackUserId: 'U_USER',
        kind: PREVIEW_KIND.BE_SANDBOX_PUSH_PR,
        payload: {},
        status: PREVIEW_STATUS.PENDING,
        previewText: '',
        responseUrl: null,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        createdAt: new Date(),
        appliedAt: null,
        cancelledAt: null,
        slackChannelId: null,
        slackMessageTs: null,
      }),
    } as unknown as jest.Mocked<CreatePreviewUsecase>);
  const applier = new BeSandboxApplier(
    generateBeDiffUsecase,
    runSandboxUsecase,
    { get: configGet } as unknown as ConfigService,
    createPreviewUsecase,
  );
  return {
    applier,
    generateBeDiffUsecase,
    runSandboxUsecase,
    configGet,
    createPreviewUsecase,
  };
};

const happyPathDiff = {
  diff: sampleDiff,
  reasoning: 'foo 반환을 2로',
  changedFiles: ['src/foo/foo.ts'],
};

const buildSandboxOutput = (overrides: {
  exitCode: number;
  stdout: string;
  stderr?: string;
  durationMs?: number;
  timedOut?: boolean;
}) => ({
  exitCode: overrides.exitCode,
  stdout: overrides.stdout,
  stderr: overrides.stderr ?? '',
  durationMs: overrides.durationMs ?? 5_000,
  timedOut: overrides.timedOut ?? false,
  stdoutTruncated: false,
  stderrTruncated: false,
});

describe('BeSandboxApplier — Phase 2a-3b (실제 git apply + jest)', () => {
  it('kind 는 PREVIEW_KIND.BE_SANDBOX_APPLY', () => {
    const { applier } = buildApplier();
    expect(applier.kind).toBe(PREVIEW_KIND.BE_SANDBOX_APPLY);
  });

  it('정상 흐름 — A/B/C 모두 통과 (exit=0 + PHASE_C_TEST_OK)', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase, configGet } =
      buildApplier();
    configGet.mockImplementation((key: string) =>
      key === 'BE_SANDBOX_HOST_REPO_PATH' ? '/custom/host/repo' : undefined,
    );
    generateBeDiffUsecase.execute.mockResolvedValue(happyPathDiff);
    runSandboxUsecase.execute.mockResolvedValue(
      buildSandboxOutput({
        exitCode: 0,
        stdout: [
          'PHASE_A_CHECK_OK',
          'PHASE_B_APPLY_OK',
          'Tests: 819 passed, 819 total',
          'PHASE_C_TEST_OK',
        ].join('\n'),
        durationMs: 45_000,
      }),
    );

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
    expect(result.message).toContain('Phase 2a-3b');
    expect(result.message).toContain('✅ Sandbox apply + test 통과');
    expect(result.message).toContain('/custom/host/repo');
    expect(result.message).toContain('@@ -1,3 +1,4 @@');
  });

  it('Phase A 실패 (check 도 통과 못 함) — sentinel 없음 + exit non-0', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue(happyPathDiff);
    runSandboxUsecase.execute.mockResolvedValue(
      buildSandboxOutput({
        exitCode: 1,
        stdout: '',
        stderr: 'error: patch failed: src/foo/foo.ts:1',
      }),
    );

    const result = await applier.apply(buildPreview());
    expect(result.message).toContain('❌ Phase A 에서 실패');
    expect(result.message).toContain('A(check) ❌');
    expect(result.message).toContain('B(apply) ❌');
    expect(result.message).toContain('C(jest) ❌');
  });

  it('Phase B 실패 (check OK, apply 실패) — PHASE_A_CHECK_OK 만 출력 + exit non-0', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue(happyPathDiff);
    runSandboxUsecase.execute.mockResolvedValue(
      buildSandboxOutput({
        exitCode: 1,
        stdout: 'PHASE_A_CHECK_OK',
        stderr: 'tar: error during copy',
      }),
    );

    const result = await applier.apply(buildPreview());
    expect(result.message).toContain('❌ Phase A 에서 실패');
    expect(result.message).toContain('A(check) ✅');
    expect(result.message).toContain('B(apply) ❌');
  });

  it('Phase C 실패 (테스트 실패) — A+B sentinel 출력, exit non-0', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue(happyPathDiff);
    runSandboxUsecase.execute.mockResolvedValue(
      buildSandboxOutput({
        exitCode: 1,
        stdout: [
          'PHASE_A_CHECK_OK',
          'PHASE_B_APPLY_OK',
          'FAIL src/foo/foo.spec.ts',
          '  expected 1 but got 2',
        ].join('\n'),
        durationMs: 18_000,
      }),
    );

    const result = await applier.apply(buildPreview());
    expect(result.message).toContain('❌ Phase B 에서 실패');
    expect(result.message).toContain('A(check) ✅');
    expect(result.message).toContain('B(apply) ✅');
    expect(result.message).toContain('C(jest) ❌');
    expect(result.message).toContain('FAIL src/foo/foo.spec.ts');
  });

  it('BE_SANDBOX_HOST_REPO_PATH 미설정 → process.cwd() 사용', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue(happyPathDiff);
    runSandboxUsecase.execute.mockResolvedValue(
      buildSandboxOutput({
        exitCode: 0,
        stdout: 'PHASE_A_CHECK_OK\nPHASE_B_APPLY_OK\nPHASE_C_TEST_OK',
      }),
    );

    await applier.apply(buildPreview());
    expect(runSandboxUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ hostMountPath: process.cwd() }),
    );
  });

  it('sandbox timedOut=true → ❌ (timed out) 표시', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue(happyPathDiff);
    runSandboxUsecase.execute.mockResolvedValue(
      buildSandboxOutput({
        exitCode: 137,
        stdout: 'PHASE_A_CHECK_OK\nPHASE_B_APPLY_OK',
        timedOut: true,
        durationMs: 180_000,
      }),
    );

    const result = await applier.apply(buildPreview());
    expect(result.message).toContain('timed out');
  });

  it('sandbox 명령에 ro mount + tmpfs 512m + network=none 그대로 전달', async () => {
    const { applier, generateBeDiffUsecase, runSandboxUsecase } =
      buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue(happyPathDiff);
    runSandboxUsecase.execute.mockResolvedValue(
      buildSandboxOutput({
        exitCode: 0,
        stdout: 'PHASE_A_CHECK_OK\nPHASE_B_APPLY_OK\nPHASE_C_TEST_OK',
      }),
    );

    await applier.apply(buildPreview());
    expect(runSandboxUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        mountMode: 'ro',
        networkMode: 'none',
        tmpfsSize: '512m',
        timeoutMs: 180_000,
      }),
    );
  });

  it('payload 형식 불일치 → PreviewActionException + diff/sandbox 둘 다 skip', async () => {
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

  it('성공 시 Phase 2b chain preview (BE_SANDBOX_PUSH_PR) 자동 생성', async () => {
    const {
      applier,
      generateBeDiffUsecase,
      runSandboxUsecase,
      createPreviewUsecase,
    } = buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue(happyPathDiff);
    runSandboxUsecase.execute.mockResolvedValue(
      buildSandboxOutput({
        exitCode: 0,
        stdout: 'PHASE_A_CHECK_OK\nPHASE_B_APPLY_OK\nPHASE_C_TEST_OK',
      }),
    );

    const result = await applier.apply(buildPreview());

    expect(createPreviewUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'U_USER',
        kind: PREVIEW_KIND.BE_SANDBOX_PUSH_PR,
        payload: expect.objectContaining({
          diff: happyPathDiff.diff,
          reasoning: happyPathDiff.reasoning,
          changedFiles: happyPathDiff.changedFiles,
          repoLabel: 'JSL107/personal_agents',
          baseBranch: 'main',
        }),
      }),
    );
    expect(result.message).toContain('GitHub PR auto-open');
  });

  it('실패 시 Phase 2b chain preview 생성 X (createPreview 호출 안 함)', async () => {
    const {
      applier,
      generateBeDiffUsecase,
      runSandboxUsecase,
      createPreviewUsecase,
    } = buildApplier();
    generateBeDiffUsecase.execute.mockResolvedValue(happyPathDiff);
    runSandboxUsecase.execute.mockResolvedValue(
      buildSandboxOutput({
        exitCode: 1,
        stdout: 'PHASE_A_CHECK_OK',
        stderr: 'apply failed',
      }),
    );

    await applier.apply(buildPreview());
    expect(createPreviewUsecase.execute).not.toHaveBeenCalled();
  });

  it('Phase 2b chain preview 생성 실패는 graceful — 본 흐름 응답은 정상 노출', async () => {
    const createPreviewUsecase = {
      execute: jest.fn().mockRejectedValue(new Error('DB down')),
    } as unknown as jest.Mocked<CreatePreviewUsecase>;
    const { applier, generateBeDiffUsecase, runSandboxUsecase } = buildApplier({
      createPreviewUsecase,
    });
    generateBeDiffUsecase.execute.mockResolvedValue(happyPathDiff);
    runSandboxUsecase.execute.mockResolvedValue(
      buildSandboxOutput({
        exitCode: 0,
        stdout: 'PHASE_A_CHECK_OK\nPHASE_B_APPLY_OK\nPHASE_C_TEST_OK',
      }),
    );

    const result = await applier.apply(buildPreview());
    expect(result.message).toContain('Sandbox apply + test 통과');
    expect(result.message).toContain('Phase 2b chain preview 생성 실패');
  });
});
