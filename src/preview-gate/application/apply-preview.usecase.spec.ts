import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import { VerifiableArtifact } from '../domain/apply-result.type';
import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import { PreviewApplier } from '../domain/port/preview-applier.port';
import {
  PREVIEW_CANCEL_REASON,
  PreviewCanceller,
} from '../domain/port/preview-canceller.port';
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
  expiresAt: new Date('2026-04-27T13:00:00.000Z'),
  createdAt: new Date('2026-04-27T11:00:00.000Z'),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  lastFailedAt: null,
  lastFailureReason: null,
  applyProgress: null,
  ...overrides,
});

const buildRepo = (
  preview: PreviewAction | null,
): jest.Mocked<PreviewActionRepositoryPort> => ({
  create: jest.fn(),
  findById: jest.fn().mockResolvedValue(preview),
  findLatestPendingForUser: jest.fn().mockResolvedValue(null),
  updatePayload: jest.fn(),
  countOutcomesByKind: jest.fn().mockResolvedValue([]),
  countByPayloadValue: jest.fn().mockResolvedValue(0),
  transition: jest
    .fn()
    .mockImplementation(({ id, status }) =>
      Promise.resolve(buildPreview({ id, status })),
    ),
  transitionIfStatus: jest
    .fn()
    .mockImplementation(({ id, to }) =>
      Promise.resolve(buildPreview({ id, status: to })),
    ),
  attachSlackMessage: jest.fn().mockResolvedValue(undefined),
  recordApplyFailure: jest.fn().mockResolvedValue(undefined),
  beginApply: jest.fn().mockResolvedValue({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    attempts: 1,
    done: [],
  }),
  recordApplyStep: jest.fn().mockResolvedValue(undefined),
  clearApplyProgress: jest.fn().mockResolvedValue(undefined),
  endApply: jest.fn().mockResolvedValue(undefined),
  findApplyInterrupted: jest.fn().mockResolvedValue([]),
  findExpiredPending: jest.fn().mockResolvedValue([]),
  findAllOpen: jest.fn().mockResolvedValue([]),
  findAllDayOutcomes: jest.fn().mockResolvedValue([]),
  findRecentAppliedByKind: jest.fn().mockResolvedValue([]),
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
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
    );

    const result = await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    // 두 번째 인자는 진행 기록 통로다 — applier 가 단계 완료를 남기는 자리(ApplyProgress).
    expect(applier.apply).toHaveBeenCalledWith(
      preview,
      expect.objectContaining({ done: [] }),
    );
    expect(repo.transition).toHaveBeenCalledWith({
      id: 'p-1',
      status: PREVIEW_STATUS.APPLIED,
    });
    expect(result.resultText).toBe('PR #707 코멘트 추가');
  });

  it('반영 시작에 진행 흔적을 새기고 끝나면 지운다 — 남아 있으면 다음 부팅이 중단으로 읽는다', async () => {
    const preview = buildPreview();
    const repo = buildRepo(preview);
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
    );

    await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(repo.beginApply).toHaveBeenCalledWith({
      id: 'p-1',
      pid: process.pid,
      at: fixedNow,
    });
    expect(repo.clearApplyProgress).toHaveBeenCalledWith({
      id: 'p-1',
      pid: process.pid,
    });
  });

  it('반영이 실패하면 흔적을 지우지 않고 끝났다고만 표시한다 — 지우면 done 이 함께 사라져 재시도가 중복 반영이 된다', async () => {
    const preview = buildPreview();
    const repo = buildRepo(preview);
    const applier: PreviewApplier = {
      kind: PREVIEW_KIND.PM_WRITE_BACK,
      apply: jest.fn().mockRejectedValue(new Error('GitHub 500')),
    };
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
    );

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('GitHub 500');

    expect(repo.endApply).toHaveBeenCalledWith({
      id: 'p-1',
      pid: process.pid,
      at: fixedNow,
    });
    expect(repo.clearApplyProgress).not.toHaveBeenCalled();
  });

  it('소유권 획득에 실패하면(다른 프로세스가 먼저 잡음) applier 를 돌리지 않는다', async () => {
    // `applying` 락은 프로세스 로컬이라 worktree 백엔드가 같은 카드를 동시에 집을 수 있다.
    // 조건부 획득이 막지 않으면 같은 비멱등 반영이 두 번 돈다.
    const preview = buildPreview();
    const repo = buildRepo(preview);
    repo.beginApply.mockResolvedValue(null);
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
    );

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('이미 처리 중');

    expect(applier.apply).not.toHaveBeenCalled();
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('완료 단계를 기록한 뒤 상태 전이가 실패해도 그 기록은 남는다 — 재승인이 같은 단계를 다시 실행하지 않게', async () => {
    // 이 순서가 실제 사고 경로다. applier 가 외부 부작용을 마치고 `done` 을 남긴 뒤
    // `transition` 이 깨지면 카드는 PENDING 으로 남아 다시 눌린다. 그때 `done` 이 지워져
    // 있으면 이미 반영된 단계가 처음부터 다시 실행된다.
    const preview = buildPreview();
    const repo = buildRepo(preview);
    repo.transition.mockRejectedValue(new Error('DB 연결 끊김'));
    const applier: PreviewApplier = {
      kind: PREVIEW_KIND.PM_WRITE_BACK,
      resumable: true,
      apply: jest.fn().mockImplementation(async (_preview, progress) => {
        await progress?.record('0:owner/repo#1');
        return { message: 'ok', artifacts: [] };
      }),
    };
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
    );

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('DB 연결 끊김');

    expect(repo.recordApplyStep).toHaveBeenCalledWith({
      id: 'p-1',
      step: '0:owner/repo#1',
    });
    // 기록을 지우는 경로를 타지 않아야 한다. 지우면 그 단계가 다음 승인에서 되살아난다.
    expect(repo.clearApplyProgress).not.toHaveBeenCalled();
    expect(repo.endApply).toHaveBeenCalled();
  });

  it('이전 시도가 남긴 done 을 applier 에 물려준다 — 물려주지 않으면 재개가 처음부터 다시 돈다', async () => {
    const preview = buildPreview();
    const repo = buildRepo(preview);
    repo.beginApply.mockResolvedValue({
      pid: process.pid,
      startedAt: fixedNow.toISOString(),
      attempts: 2,
      done: ['0:owner/repo#1'],
    });
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
    );

    await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(applier.apply).toHaveBeenCalledWith(
      preview,
      expect.objectContaining({ done: ['0:owner/repo#1'] }),
    );
  });

  it('반영 실패 시 approval.failed 를 발행한다 — 카드가 돌아온 것만으로는 "안 눌림" 과 구분되지 않는다', async () => {
    const preview = buildPreview();
    const repo = buildRepo(preview);
    const applier: PreviewApplier = {
      kind: PREVIEW_KIND.PM_WRITE_BACK,
      apply: jest.fn().mockRejectedValue(new Error('Notion 권한 없음')),
    };
    const bus = {
      publish: jest.fn(),
      stream: jest.fn(),
    } as unknown as ConsoleEventBus;
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
      bus,
    );

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('Notion 권한 없음');

    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approval.failed',
        reason: 'Notion 권한 없음',
      }),
    );
  });

  it('apply 성공 시 approval.resolved 이벤트를 발행한다', async () => {
    const preview = buildPreview();
    const repo = buildRepo(preview);
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    const bus = {
      publish: jest.fn(),
      stream: jest.fn(),
    } as unknown as ConsoleEventBus;
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
      bus,
    );

    await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(bus.publish).toHaveBeenCalledWith({
      type: 'approval.resolved',
      approval: {
        id: 'p-1',
        agentType: 'PM',
        title: 'preview',
        createdAt: '2026-04-27T11:00:00.000Z',
        expiresAt: '2026-04-27T13:00:00.000Z',
      },
    });
  });

  it('미존재 previewId 면 NOT_FOUND', async () => {
    const repo = buildRepo(null);
    const usecase = new ApplyPreviewUsecase(repo, [], [], [], buildCard());

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
    const usecase = new ApplyPreviewUsecase(repo, [], [], [], buildCard());

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.WRONG_OWNER,
    });
  });

  it('이미 APPLIED 인 preview 는 ALREADY_RESOLVED 예외', async () => {
    const repo = buildRepo(buildPreview({ status: PREVIEW_STATUS.APPLIED }));
    const usecase = new ApplyPreviewUsecase(repo, [], [], [], buildCard());

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
    const usecase = new ApplyPreviewUsecase(repo, [], [], [], buildCard());

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

  // 스위퍼가 훑기 전에 사용자가 뒤늦게 ✅ 를 누른 경우도 만료다. 여기서 후처리를 빠뜨리면
  // 스위퍼 경로만 고쳐도 연동 레코드가 이 경로로 계속 PENDING 잔류한다.
  it('TTL 지난 카드에 apply 를 시도하면 canceller 를 EXPIRED 사유로 호출한다', async () => {
    const repo = buildRepo(
      buildPreview({
        kind: PREVIEW_KIND.PREFERENCE_PROFILE,
        expiresAt: new Date('2026-04-27T11:30:00.000Z'),
      }),
    );
    // 전이 후 row 의 kind 로 canceller 를 찾으므로 mock 도 kind 를 보존해야 한다.
    repo.transition.mockImplementation(({ id, status }) =>
      Promise.resolve(
        buildPreview({ id, status, kind: PREVIEW_KIND.PREFERENCE_PROFILE }),
      ),
    );
    const canceller: jest.Mocked<PreviewCanceller> = {
      kind: PREVIEW_KIND.PREFERENCE_PROFILE,
      onCancel: jest.fn().mockResolvedValue(undefined),
    };
    const usecase = new ApplyPreviewUsecase(
      repo,
      [],
      [],
      [canceller],
      buildCard(),
    );

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.EXPIRED,
    });
    expect(canceller.onCancel).toHaveBeenCalledWith(
      expect.objectContaining({ status: PREVIEW_STATUS.EXPIRED }),
      PREVIEW_CANCEL_REASON.EXPIRED,
    );
  });

  it('kind 에 매칭되는 PreviewApplier 가 없으면 NO_APPLIER_FOR_KIND 예외', async () => {
    // PM_WRITE_BACK preview 가 있는데 PREVIEW_APPLIERS multi-provider 가 비어있는 DI 미스 상황을 시뮬레이션.
    const repo = buildRepo(buildPreview());
    const usecase = new ApplyPreviewUsecase(repo, [], [], [], buildCard());

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
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
    );

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('GitHub API down');
    // EXPIRED 전이는 호출되지 않음 (만료 아니므로). APPLIED 전이도 호출되지 않음.
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('PreviewActionException 은 도메인 정책 그대로 throw (Slack handler 가 user-friendly 메시지로 변환)', async () => {
    const repo = buildRepo(buildPreview());
    const usecase = new ApplyPreviewUsecase(repo, [], [], [], buildCard());

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
      [],
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
      [],
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
      [],
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
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], [], card);

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
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], [], card);

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
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], [], card);

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

  // 접수형 호출자(콘솔)를 위한 판정 전용 입구. 실행 없이 "지금 누를 수 있는가" 만 본다.
  it('assertApplicable 은 applier 를 돌리지 않고 통과시킨다', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    const card = buildCard();
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], [], card);

    const preview = await usecase.assertApplicable({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(preview.id).toBe('p-1');
    expect(applier.apply).not.toHaveBeenCalled();
    expect(repo.transition).not.toHaveBeenCalled();
    expect(card.update).not.toHaveBeenCalled();
  });

  it('assertApplicable 도 처리 중인 카드는 ALREADY_APPLYING 으로 거절', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    let releaseApply: () => void = () => {};
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    applier.apply.mockReturnValue(
      applyGate.then(() => ({ message: 'ok', artifacts: [] })),
    );
    const card = buildCard();
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], [], card);

    const first = usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const error = await usecase
      .assertApplicable({
        previewId: 'p-1',
        slackUserId: 'U1',
        now: fixedNow,
      })
      .catch((caught) => caught);

    expect(error).toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.ALREADY_APPLYING,
    });
    releaseApply();
    await first;
  });

  // applier 가 없는 kind(CAREER_JD_GAP_BLOG 등)를 접수에서 거른다. 여기서 통과시키면
  // 202 를 받은 뒤 백그라운드에서 죽어, 사용자에게는 "눌렀는데 카드만 돌아오는" 것으로 보인다.
  it('assertApplicable 은 applier 가 없는 kind 를 NO_APPLIER_FOR_KIND 로 거절', async () => {
    const repo = buildRepo(
      buildPreview({ kind: PREVIEW_KIND.CAREER_JD_GAP_BLOG }),
    );
    const card = buildCard();
    // applier 목록에 그 kind 가 없다.
    const usecase = new ApplyPreviewUsecase(
      repo,
      [buildApplier(PREVIEW_KIND.PM_WRITE_BACK)],
      [],
      [],
      card,
    );

    const error = await usecase
      .assertApplicable({
        previewId: 'p-1',
        slackUserId: 'U1',
        now: fixedNow,
      })
      .catch((caught) => caught);

    expect(error).toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
    });
  });

  // 접수 판정은 락을 잡지 않아, 거의 동시에 들어온 둘이 모두 통과할 수 있다. 그래도 **실행은
  // 한 번뿐**이라는 것이 이 구조가 기대는 계약이다 — `execute` 가 락을 동기적으로 잡으므로
  // 뒤엣것이 그 안에서 끊긴다. 이 단언이 없으면 접수와 실행 사이의 check-then-act 경계가
  // 고정되지 않아, 나중에 락 획득 시점을 옮겨도 아무도 모른다.
  it('접수를 둘 다 통과해도 applier 는 한 번만 돈다', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    let releaseApply: () => void = () => {};
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    applier.apply.mockReturnValue(
      applyGate.then(() => ({ message: 'ok', artifacts: [] })),
    );
    const card = buildCard();
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], [], card);

    // 두 요청이 모두 접수 판정을 통과한 상태를 만든다(아직 아무도 락을 잡지 않았다).
    await usecase.assertApplicable({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });
    await usecase.assertApplicable({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    const first = usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const secondError = await usecase
      .execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow })
      .catch((error) => error);

    expect(secondError).toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.ALREADY_APPLYING,
    });
    expect(applier.apply).toHaveBeenCalledTimes(1);
    releaseApply();
    await first;
  });

  it('assertApplicable 은 없는 카드를 NOT_FOUND 로 거절', async () => {
    const repo = buildRepo(null);
    const card = buildCard();
    const usecase = new ApplyPreviewUsecase(repo, [], [], [], card);

    const error = await usecase
      .assertApplicable({
        previewId: 'p-1',
        slackUserId: 'U1',
        now: fixedNow,
      })
      .catch((caught) => caught);

    expect(error).toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NOT_FOUND,
    });
  });

  it('카드 갱신이 throw 해도 apply 결과는 그대로 반환 (best-effort)', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK, '완료');
    const card = buildCard();
    card.update.mockRejectedValue(new Error('slack down'));
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], [], card);

    const result = await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(result.resultText).toBe('완료');
  });

  it('applier 실패 시 실패 사유와 시각을 행에 기록한다', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    applier.apply.mockRejectedValue(new Error('Notion down'));
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
    );

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('Notion down');

    expect(repo.recordApplyFailure).toHaveBeenCalledWith({
      id: 'p-1',
      reason: '[apply] Notion down',
      at: fixedNow,
    });
  });

  it('transition 실패는 부작용이 반영된 뒤이므로 사유에 단계를 구분해 남긴다', async () => {
    const repo = buildRepo(buildPreview());
    repo.transition.mockRejectedValue(new Error('db write failed'));
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
    );

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('db write failed');

    // applier 는 성공했으므로 외부 부작용은 이미 반영됐다 — apply 실패와 구분돼야 한다.
    expect(applier.apply).toHaveBeenCalled();
    expect(repo.recordApplyFailure).toHaveBeenCalledWith({
      id: 'p-1',
      reason: '[transition] db write failed',
      at: fixedNow,
    });
  });

  it('실패 기록 자체가 throw 해도 원래 실패 사유가 전파되고 카드 갱신도 진행된다', async () => {
    const repo = buildRepo(buildPreview());
    repo.recordApplyFailure.mockRejectedValue(new Error('db down'));
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    applier.apply.mockRejectedValue(new Error('Notion down'));
    const card = buildCard();
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], [], card);

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('Notion down');

    // 기록이 깨져도 카드는 버튼이 되살아난 상태로 돌아가야 한다.
    const states = card.update.mock.calls.map((call) => call[0].state);
    expect(states).toEqual(['APPLYING', 'APPLY_FAILED']);
  });

  it('실패 기록이 카드 갱신보다 먼저 일어난다', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    applier.apply.mockRejectedValue(new Error('Notion down'));
    const card = buildCard();
    const usecase = new ApplyPreviewUsecase(repo, [applier], [], [], card);

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('Notion down');

    // 카드 갱신은 Slack 왕복이라 느리다. 뒤에 두면 그 시간만큼 기록이 밀리므로 순서를 고정한다.
    // card.update 의 두 번째 호출이 APPLY_FAILED — 첫 번째(APPLYING)는 실패 전이다.
    const recordOrder = repo.recordApplyFailure.mock.invocationCallOrder[0];
    const failedCardOrder = card.update.mock.invocationCallOrder[1];
    expect(recordOrder).toBeLessThan(failedCardOrder);
  });

  it('apply 성공 시 실패 기록을 남기지 않는다', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK, '완료');
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
    );

    await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(repo.recordApplyFailure).not.toHaveBeenCalled();
  });

  it('만료로 거절된 카드는 실패 기록을 남기지 않는다 — 실행한 적이 없다', async () => {
    const repo = buildRepo(
      buildPreview({ expiresAt: new Date('2026-04-27T11:30:00.000Z') }),
    );
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    const usecase = new ApplyPreviewUsecase(
      repo,
      [applier],
      [],
      [],
      buildCard(),
    );

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.EXPIRED,
    });

    expect(repo.recordApplyFailure).not.toHaveBeenCalled();
  });
});
