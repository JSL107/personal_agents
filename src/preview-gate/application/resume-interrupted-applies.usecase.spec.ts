import { Test } from '@nestjs/testing';

import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import {
  PREVIEW_APPLIERS,
  PreviewApplier,
} from '../domain/port/preview-applier.port';
import {
  PREVIEW_CARD_PORT,
  PreviewCardPort,
} from '../domain/port/preview-card.port';
import {
  ApplyProgressState,
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../domain/preview-action.type';
import { ApplyPreviewUsecase } from './apply-preview.usecase';
import { ResumeInterruptedAppliesUsecase } from './resume-interrupted-applies.usecase';

// 이 값의 프로세스는 존재하지 않는다 — macOS·Linux 모두 pid 상한(기본 99,999 / 4,194,304)보다
// 크다. "죽은 프로세스가 남긴 흔적" 을 만드는 데 쓴다.
const DEAD_PID = 2_147_483_646;

const fixedNow = new Date('2026-09-23T10:00:00.000Z');

const buildProgress = (
  overrides: Partial<ApplyProgressState> = {},
): ApplyProgressState => ({
  pid: DEAD_PID,
  startedAt: '2026-09-23T09:22:00.000Z',
  attempts: 1,
  done: [],
  ...overrides,
});

const buildPreview = (
  overrides: Partial<PreviewAction> = {},
): PreviewAction => ({
  id: 'p-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.EVENING_CAREER_REFLECT,
  payload: {},
  status: PREVIEW_STATUS.PENDING,
  previewText: '경력 반영',
  // 기본은 아직 유효한 카드 — TTL 은 그것을 다루는 케이스에서만 당긴다.
  expiresAt: new Date('2026-09-23T19:00:00.000Z'),
  createdAt: new Date('2026-09-22T19:10:00.000Z'),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  lastFailedAt: null,
  lastFailureReason: null,
  applyProgress: buildProgress(),
  ...overrides,
});

const buildRepo = (
  interrupted: PreviewAction[],
): jest.Mocked<
  Pick<
    PreviewActionRepositoryPort,
    | 'findApplyInterrupted'
    | 'recordApplyFailure'
    | 'clearApplyProgress'
    | 'endApply'
    | 'transition'
  >
> =>
  ({
    findApplyInterrupted: jest.fn().mockResolvedValue(interrupted),
    recordApplyFailure: jest.fn().mockResolvedValue(undefined),
    clearApplyProgress: jest.fn().mockResolvedValue(undefined),
    endApply: jest.fn().mockResolvedValue(undefined),
    transition: jest.fn(),
  }) as never;

const buildApplier = (resumable: boolean): PreviewApplier => ({
  kind: PREVIEW_KIND.EVENING_CAREER_REFLECT,
  resumable,
  apply: jest.fn(),
});

const build = ({
  interrupted,
  appliers = [buildApplier(true)],
}: {
  interrupted: PreviewAction[];
  appliers?: PreviewApplier[];
}) => {
  const repository = buildRepo(interrupted);
  const card: jest.Mocked<PreviewCardPort> = {
    update: jest.fn().mockResolvedValue(undefined),
  };
  const applyPreview = {
    execute: jest.fn().mockResolvedValue({ preview: null, resultText: 'ok' }),
  } as unknown as jest.Mocked<ApplyPreviewUsecase>;
  const published: unknown[] = [];
  const consoleEvents = {
    publish: jest.fn().mockImplementation((event: unknown) => {
      published.push(event);
    }),
  } as unknown as ConsoleEventBus;

  const usecase = new ResumeInterruptedAppliesUsecase(
    repository as never,
    appliers,
    card,
    applyPreview,
    consoleEvents,
  );
  return { usecase, repository, card, applyPreview, published };
};

// 재개가 끝났는지 기다린다 — `sweep` 은 부팅을 막지 않으려고 재개를 await 하지 않는다.
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('ResumeInterruptedAppliesUsecase', () => {
  it('(a) 흔적의 pid 가 살아 있으면 아무것도 하지 않는다 — 다른 백엔드가 반영 중이다', async () => {
    // 로컬 DB 를 worktree 백엔드와 공유한다. 진행 중인 남의 반영을 중단으로 오인해 재개하면
    // 같은 반영이 둘이 돌아 결과가 두 번 들어간다.
    const { usecase, repository, applyPreview } = build({
      interrupted: [
        buildPreview({ applyProgress: buildProgress({ pid: process.pid }) }),
      ],
    });

    await usecase.sweep(fixedNow);
    await flush();

    expect(applyPreview.execute).not.toHaveBeenCalled();
    expect(repository.recordApplyFailure).not.toHaveBeenCalled();
    expect(repository.clearApplyProgress).not.toHaveBeenCalled();
  });

  it('(b) 조건을 다 만족하면 이어서 실행한다', async () => {
    const { usecase, applyPreview } = build({
      interrupted: [buildPreview()],
    });

    await usecase.sweep(fixedNow);
    await flush();

    // 죽은 pid 를 명시해야 이어받을 수 있다. 중단된 흔적에는 "끝났다" 표시가 없어(죽은
    // 프로세스는 그것을 남기지 못한다) 소유권 획득이 기본적으로 거절되기 때문이다 —
    // 이 값을 빠뜨리면 재개가 매번 `ALREADY_APPLYING` 으로 튕긴다.
    expect(applyPreview.execute).toHaveBeenCalledWith({
      previewId: 'p-1',
      slackUserId: 'U1',
      takeOverPid: DEAD_PID,
    });
  });

  it('(c) TTL 이 지났으면 재개하지 않고 마감한다', async () => {
    const { usecase, repository, applyPreview } = build({
      interrupted: [
        buildPreview({ expiresAt: new Date('2026-09-23T09:00:00.000Z') }),
      ],
    });

    await usecase.sweep(fixedNow);
    await flush();

    expect(applyPreview.execute).not.toHaveBeenCalled();
    expect(repository.recordApplyFailure).toHaveBeenCalledTimes(1);
  });

  it('(d) 시도 횟수 상한에 닿으면 재개하지 않는다 — 크래시를 부르는 반영이 부팅마다 되살아나지 않게', async () => {
    const { usecase, repository, applyPreview } = build({
      interrupted: [
        buildPreview({ applyProgress: buildProgress({ attempts: 2 }) }),
      ],
    });

    await usecase.sweep(fixedNow);
    await flush();

    expect(applyPreview.execute).not.toHaveBeenCalled();
    expect(repository.recordApplyFailure).toHaveBeenCalledTimes(1);
  });

  it('(e) applier 가 resumable 이 아니면 재개하지 않는다 — 부작용이 갔는지 알 수 없다', async () => {
    const { usecase, repository, applyPreview } = build({
      interrupted: [buildPreview()],
      appliers: [buildApplier(false)],
    });

    await usecase.sweep(fixedNow);
    await flush();

    expect(applyPreview.execute).not.toHaveBeenCalled();
    expect(repository.recordApplyFailure).toHaveBeenCalledTimes(1);
  });

  it('(f) 마감 안내에 이미 반영된 단계가 실린다 — 이것이 없으면 사용자가 모른 채 다시 눌러 중복 반영한다', async () => {
    const { usecase, repository, published } = build({
      interrupted: [
        buildPreview({
          expiresAt: new Date('2026-09-23T09:00:00.000Z'),
          applyProgress: buildProgress({
            done: ['0:owner/repo#1', '1:owner/other#2'],
          }),
        }),
      ],
    });

    await usecase.sweep(fixedNow);
    await flush();

    const [[recorded]] = repository.recordApplyFailure.mock.calls;
    expect(recorded.reason).toContain('2단계까지 반영된 것이 확인됩니다');
    expect(recorded.reason).toContain('0:owner/repo#1');
    // 기록이 보존되므로 재승인이 그 단계를 건너뛴다는 것까지 말해야 한다.
    expect(recorded.reason).toContain('건너뛰고');
    // 같은 경고가 콘솔 화면에도 닿아야 한다 — 원장에만 남으면 사용자는 끝까지 모른다.
    expect(published).toEqual([
      expect.objectContaining({
        type: 'approval.failed',
        reason: expect.stringContaining('2단계까지 반영된 것이 확인') as string,
      }),
    ]);
  });

  it('(f-2) 마감 안내는 슬랙 카드 본문에도 실린다 — 부팅 중에는 SSE 구독자가 아직 없다', async () => {
    // 이 훅은 `app.listen()` 보다 먼저 돌고 ConsoleEventBus 는 구독 이전 이벤트를 재전달하지
    // 않는다. 카드에 싣지 않으면 부팅 중 마감은 사용자에게 도달할 경로가 없다.
    const { usecase, card } = build({
      interrupted: [
        buildPreview({
          expiresAt: new Date('2026-09-23T09:00:00.000Z'),
          applyProgress: buildProgress({ done: ['0:owner/repo#1'] }),
        }),
      ],
    });

    await usecase.sweep(fixedNow);
    await flush();

    const [[updated]] = card.update.mock.calls;
    expect(updated.state).toBe('APPLY_FAILED');
    expect(updated.resultText).toContain('1단계까지 반영된 것이 확인됩니다');
  });

  it('(f-3) 단계 기록을 남기지 않는 applier 는 "반영된 것이 없다" 고 단정하지 않는다', async () => {
    // 비재개형에서 빈 `done` 은 외부 호출이 안 갔다는 증거가 아니다. 없다고 단정하고 재시도를
    // 권하면 이미 나간 발행이 한 번 더 나간다.
    const { usecase, repository } = build({
      interrupted: [
        buildPreview({ applyProgress: buildProgress({ done: [] }) }),
      ],
      appliers: [buildApplier(false)],
    });

    await usecase.sweep(fixedNow);
    await flush();

    const [[recorded]] = repository.recordApplyFailure.mock.calls;
    expect(recorded.reason).toContain('원장으로는 알 수 없습니다');
    expect(recorded.reason).not.toContain('반영된 것은 없습니다');
  });

  it('(f-4) 마감은 진행 기록을 지우지 않고 끝났다고만 표시한다 — done 을 지우면 재승인이 같은 단계를 다시 실행한다', async () => {
    const { usecase, repository } = build({
      interrupted: [
        buildPreview({
          expiresAt: new Date('2026-09-23T09:00:00.000Z'),
          applyProgress: buildProgress({ done: ['0:owner/repo#1'] }),
        }),
      ],
    });

    await usecase.sweep(fixedNow);
    await flush();

    expect(repository.endApply).toHaveBeenCalledWith({
      id: 'p-1',
      pid: DEAD_PID,
      at: fixedNow,
    });
    expect(repository.clearApplyProgress).not.toHaveBeenCalled();
  });

  it('(f-5) 이미 끝났다고 표시된 흔적은 다시 집지 않는다 — 같은 안내가 부팅마다 반복되지 않게', async () => {
    const { usecase, repository, applyPreview } = build({
      interrupted: [
        buildPreview({
          applyProgress: buildProgress({
            done: ['0:owner/repo#1'],
            endedAt: '2026-09-23T09:30:00.000Z',
          }),
        }),
      ],
    });

    await usecase.sweep(fixedNow);
    await flush();

    expect(applyPreview.execute).not.toHaveBeenCalled();
    expect(repository.recordApplyFailure).not.toHaveBeenCalled();
    expect(repository.endApply).not.toHaveBeenCalled();
  });

  it('(g) 마감은 status 를 바꾸지 않는다 — 실행 실패는 사용자의 거부가 아니다', async () => {
    // 거부로 기록하면 preview-canceller 계열이 그것을 "사용자가 원치 않았다" 로 학습한다.
    const { usecase, repository, card } = build({
      interrupted: [
        buildPreview({ expiresAt: new Date('2026-09-23T09:00:00.000Z') }),
      ],
    });

    await usecase.sweep(fixedNow);
    await flush();

    expect(repository.transition).not.toHaveBeenCalled();
    expect(card.update).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'APPLY_FAILED' }),
    );
  });

  it('(h) 마감 표시는 죽은 프로세스의 pid 로 남긴다 — 그 사이 다른 쪽이 새 시도를 시작했다면 건드리지 않게', async () => {
    const { usecase, repository } = build({
      interrupted: [
        buildPreview({ expiresAt: new Date('2026-09-23T09:00:00.000Z') }),
      ],
    });

    await usecase.sweep(fixedNow);
    await flush();

    expect(repository.endApply).toHaveBeenCalledWith({
      id: 'p-1',
      pid: DEAD_PID,
      at: fixedNow,
    });
  });

  // 위 케이스들은 생성자를 손으로 부르므로 **NestJS DI 를 한 번도 거치지 않는다.** 토큰을 잘못
  // 적었거나 `@Optional()` 을 빠뜨렸거나 모듈 등록을 잊었어도 전부 통과한다 — 그 사고는 부팅해야
  // 드러나고, 이 레포는 실제로 그 계열(`Number` provider not found)을 겪었다.
  it('(i) NestJS 가 이 클래스를 조립하고 부팅이 훅을 실제로 부른다', async () => {
    const findApplyInterrupted = jest.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: PREVIEW_ACTION_REPOSITORY_PORT,
          useValue: { findApplyInterrupted },
        },
        { provide: PREVIEW_APPLIERS, useValue: [] },
        { provide: PREVIEW_CARD_PORT, useValue: { update: jest.fn() } },
        { provide: ApplyPreviewUsecase, useValue: { execute: jest.fn() } },
        ResumeInterruptedAppliesUsecase,
        // ConsoleEventBus 는 일부러 넣지 않는다 — `@Optional()` 이 빠지면 여기서 조립이 깨진다.
      ],
    }).compile();

    await moduleRef.init();

    // 등록만 하고 훅이 안 불리면 이 단언이 떨어진다. 등록과 호출은 다른 문제다.
    expect(findApplyInterrupted).toHaveBeenCalled();
    await moduleRef.close();
  });
});
