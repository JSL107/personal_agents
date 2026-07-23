import { VerifiableArtifact } from '../domain/apply-result.type';
import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import { PreviewApplier } from '../domain/port/preview-applier.port';
import { PreviewCardPort } from '../domain/port/preview-card.port';
import { ResultVerifier } from '../domain/port/result-verifier.port';
import { PreviewActionException } from '../domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../domain/preview-action.type';
import { PreviewActionErrorCode } from '../domain/preview-action-error-code.enum';
import { ApplyPreviewUsecase } from './apply-preview.usecase';

const fixedNow = new Date('2026-04-27T12:00:00.000Z');

const buildPreview = (
  overrides: Partial<PreviewAction> = {},
): PreviewAction => ({
  id: 'p-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.PM_WRITE_BACK,
  payload: { foo: 'bar' },
  status: PREVIEW_STATUS.PENDING,
  previewText: 'preview',
  responseUrl: null,
  expiresAt: new Date('2026-04-27T13:00:00.000Z'),
  createdAt: new Date('2026-04-27T11:00:00.000Z'),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  ...overrides,
});

const buildRepo = (
  preview: PreviewAction | null,
): jest.Mocked<PreviewActionRepositoryPort> => ({
  create: jest.fn(),
  findById: jest.fn().mockResolvedValue(preview),
  findLatestPendingForUser: jest.fn().mockResolvedValue(null),
  countOutcomesByKind: jest.fn().mockResolvedValue([]),
  transition: jest
    .fn()
    .mockImplementation(({ id, status }) =>
      Promise.resolve(buildPreview({ id, status })),
    ),
  attachSlackMessage: jest.fn().mockResolvedValue(undefined),
  findExpiredPending: jest.fn().mockResolvedValue([]),
});

const buildApplier = (
  kind: PreviewApplier['kind'],
  message = 'applied',
  artifacts: VerifiableArtifact[] = [],
): jest.Mocked<PreviewApplier> => ({
  kind,
  apply: jest.fn().mockResolvedValue({ message, artifacts }),
});

const buildCard = (): jest.Mocked<PreviewCardPort> => ({
  update: jest.fn().mockResolvedValue(undefined),
});

describe('ApplyPreviewUsecase', () => {
  it('PENDING + 소유자 + ttl 통과 시 strategy.apply 위임 후 APPLIED 전이', async () => {
    const preview = buildPreview();
    const repo = buildRepo(preview);
    const applier = buildApplier(
      PREVIEW_KIND.PM_WRITE_BACK,
      'PR #707 코멘트 추가',
    );
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], buildCard());

    const result = await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(applier.apply).toHaveBeenCalledWith(preview);
    expect(repo.transition).toHaveBeenCalledWith({
      id: 'p-1',
      status: PREVIEW_STATUS.APPLIED,
    });
    expect(result.resultText).toBe('PR #707 코멘트 추가');
  });

  it('미존재 previewId 면 NOT_FOUND', async () => {
    const repo = buildRepo(null);
    const usecase = new ApplyPreviewUsecase(repo, [], [], buildCard());

    await expect(
      usecase.execute({
        previewId: 'missing',
        slackUserId: 'U1',
        now: fixedNow,
      }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NOT_FOUND,
    });
  });

  it('owner 매칭 실패 시 WRONG_OWNER 예외 (다른 사용자 preview 보호)', async () => {
    const repo = buildRepo(buildPreview({ slackUserId: 'U-other' }));
    const usecase = new ApplyPreviewUsecase(repo, [], [], buildCard());

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.WRONG_OWNER,
    });
  });

  it('이미 APPLIED 인 preview 는 ALREADY_RESOLVED 예외', async () => {
    const repo = buildRepo(buildPreview({ status: PREVIEW_STATUS.APPLIED }));
    const usecase = new ApplyPreviewUsecase(repo, [], [], buildCard());

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.ALREADY_RESOLVED,
    });
  });

  it('만료된 preview 는 EXPIRED 전이 후 EXPIRED 예외', async () => {
    const repo = buildRepo(
      buildPreview({ expiresAt: new Date('2026-04-27T11:30:00.000Z') }),
    );
    const usecase = new ApplyPreviewUsecase(repo, [], [], buildCard());

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.EXPIRED,
    });
    expect(repo.transition).toHaveBeenCalledWith({
      id: 'p-1',
      status: PREVIEW_STATUS.EXPIRED,
    });
  });

  it('kind 에 매칭되는 PreviewApplier 가 없으면 NO_APPLIER_FOR_KIND 예외', async () => {
    // PM_WRITE_BACK preview 가 있는데 PREVIEW_APPLIERS multi-provider 가 비어있는 DI 미스 상황을 시뮬레이션.
    const repo = buildRepo(buildPreview());
    const usecase = new ApplyPreviewUsecase(repo, [], [], buildCard());

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
    });
  });

  it('strategy.apply 가 throw 하면 APPLIED 전이 안 함 (재시도 가능)', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    applier.apply.mockRejectedValue(new Error('GitHub API down'));
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], buildCard());

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('GitHub API down');
    // EXPIRED 전이는 호출되지 않음 (만료 아니므로). APPLIED 전이도 호출되지 않음.
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('PreviewActionException 은 도메인 정책 그대로 throw (Slack handler 가 user-friendly 메시지로 변환)', async () => {
    const repo = buildRepo(buildPreview());
    const usecase = new ApplyPreviewUsecase(repo, [], [], buildCard());

    const error = await usecase
      .execute({
        previewId: 'p-1',
        slackUserId: 'U1',
        now: fixedNow,
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(PreviewActionException);
  });

  it('apply 후 artifacts 를 ResultVerifier 로 검증해 resultText 에 ✅ 합성 (verified)', async () => {
    const repo = buildRepo(buildPreview());
    const artifact: VerifiableArtifact = {
      type: 'github_pr',
      repo: 'o/r',
      prNumber: 707,
    };
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK, 'PR open 완료', [
      artifact,
    ]);
    const verifier: jest.Mocked<ResultVerifier> = {
      supports: jest.fn().mockReturnValue(true),
      verify: jest
        .fn()
        .mockResolvedValue({ verified: true, detail: 'PR o/r#707 반영 확인' }),
    };
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [verifier],
      buildCard(),
    );

    const result = await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(verifier.verify).toHaveBeenCalledWith(artifact);
    expect(result.resultText).toContain('PR open 완료');
    expect(result.resultText).toContain('✅ PR o/r#707 반영 확인');
  });

  it('검증 실패(verified=false, unverifiableReason 없음)면 수동 확인 안내 합성', async () => {
    const repo = buildRepo(buildPreview());
    const artifact: VerifiableArtifact = {
      type: 'github_pr',
      repo: 'o/r',
      prNumber: 7,
    };
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK, 'PR open 완료', [
      artifact,
    ]);
    const verifier: jest.Mocked<ResultVerifier> = {
      supports: jest.fn().mockReturnValue(true),
      verify: jest
        .fn()
        .mockResolvedValue({ verified: false, detail: 'PR o/r#7 반영 확인' }),
    };
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [verifier],
      buildCard(),
    );

    const result = await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(result.resultText).toContain('⚠️ 반영 확인 실패');
  });

  it('artifacts 가 없으면 검증 skip — message 그대로 (기존 동작 회귀)', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK, '동기화 완료');
    const verifier: jest.Mocked<ResultVerifier> = {
      supports: jest.fn(),
      verify: jest.fn(),
    };
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [verifier],
      buildCard(),
    );

    const result = await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(verifier.verify).not.toHaveBeenCalled();
    expect(result.resultText).toBe('동기화 완료');
  });

  it('apply 성공 시 카드를 APPLYING → APPLIED 순서로 갱신한다', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK, '동기화 완료');
    const card = buildCard();
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], card);

    await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    const states = card.update.mock.calls.map((call) => call[0].state);
    expect(states).toEqual(['APPLYING', 'APPLIED']);
  });

  it('applier 실패 시 카드를 APPLY_FAILED 로 갱신하고 APPLIED 전이 안 함', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    applier.apply.mockRejectedValue(new Error('Notion down'));
    const card = buildCard();
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], card);

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('Notion down');

    const states = card.update.mock.calls.map((call) => call[0].state);
    expect(states).toEqual(['APPLYING', 'APPLY_FAILED']);
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('처리 중인 previewId 재진입은 ALREADY_APPLYING 으로 거절', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    // apply 를 gate 로 매달아 첫 호출이 진행 중(락 보유)인 상태를 만든다.
    // gate/releaseApply 는 미리 고정 — apply 도달 시점에 재설정하면 release 가 no-op 되는 레이스가 생긴다.
    let releaseApply: () => void = () => {};
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    applier.apply.mockReturnValue(
      applyGate.then(() => ({ message: 'ok', artifacts: [] })),
    );
    const card = buildCard();
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], card);

    const first = usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });
    // first 가 apply 단계(락 보유)까지 진입하도록 이벤트 루프를 한 바퀴 돌린다.
    await new Promise((resolve) => setImmediate(resolve));
    const secondError = await usecase
      .execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow })
      .catch((error) => error);

    expect(secondError).toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.ALREADY_APPLYING,
    });
    releaseApply();
    await first;
  });

  it('카드 갱신이 throw 해도 apply 결과는 그대로 반환 (best-effort)', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK, '완료');
    const card = buildCard();
    card.update.mockRejectedValue(new Error('slack down'));
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], card);

    const result = await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(result.resultText).toBe('완료');
  });
});
