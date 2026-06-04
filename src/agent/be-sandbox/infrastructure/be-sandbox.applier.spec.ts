import { PreviewActionException } from '../../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../../preview-gate/domain/preview-action-error-code.enum';
import { RunSandboxUsecase } from '../../../sandbox/application/run-sandbox.usecase';
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

describe('BeSandboxApplier', () => {
  const runSandboxUsecase = {
    execute: jest.fn(),
  } as unknown as jest.Mocked<RunSandboxUsecase>;

  const applier = new BeSandboxApplier(runSandboxUsecase);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('kind 는 PREVIEW_KIND.BE_SANDBOX_APPLY', () => {
    expect(applier.kind).toBe(PREVIEW_KIND.BE_SANDBOX_APPLY);
  });

  it('정상 payload — sandbox 실행 + 결과 요약 반환', async () => {
    runSandboxUsecase.execute.mockResolvedValue({
      exitCode: 0,
      stdout: '[BE_SANDBOX_APPLY scaffold] codex patch + pnpm test 미구현',
      stderr: '',
      durationMs: 250,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const result = await applier.apply(buildPreview());

    expect(runSandboxUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.stringContaining('BE_SANDBOX_APPLY scaffold'),
        mountMode: 'ro',
        networkMode: 'none',
      }),
    );
    expect(result).toContain('BE Sandbox Apply');
    expect(result).toContain('JSL107/personal_agents');
    expect(result).toContain('main');
    expect(result).toContain('Sandbox exit: 0');
    expect(result).toContain('Phase 2a-1 scaffold');
  });

  it('payload 형식 불일치 → PreviewActionException', async () => {
    await expect(
      applier.apply(buildPreview({}, { 잘못된: '형식' })),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
    });
    await expect(
      applier.apply(buildPreview({}, { 잘못된: '형식' })),
    ).rejects.toBeInstanceOf(PreviewActionException);
    expect(runSandboxUsecase.execute).not.toHaveBeenCalled();
  });

  it('payload 가 일부 string 비어 있으면 거절', async () => {
    await expect(
      applier.apply(
        buildPreview(
          {},
          {
            planText: '',
            repoLabel: 'foo/bar',
            baseBranch: 'main',
          },
        ),
      ),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
    });
    expect(runSandboxUsecase.execute).not.toHaveBeenCalled();
  });

  it('sandbox timeout 발생 시 결과에 timedOut 표시', async () => {
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
});
