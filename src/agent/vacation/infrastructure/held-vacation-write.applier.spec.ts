import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { CancelLeaveUsecase } from '../application/cancel-leave.usecase';
import { RegisterLeaveUsecase } from '../application/register-leave.usecase';
import { VacationException } from '../domain/vacation.exception';
import { VacationErrorCode } from '../domain/vacation-error-code.enum';
import { HeldVacationWriteApplier } from './held-vacation-write.applier';
import { LeaveUsagePrismaRepository } from './leave-usage.prisma.repository';

const date = { year: 2026, month: 11, day: 25 };
const balance = {
  hireDate: date,
  asOf: date,
  periodStart: date,
  periodEnd: date,
  grantedDays: 15,
  usedDays: 1,
  remainingDays: 14,
  usagesInPeriod: [],
};
const preview: PreviewAction = {
  id: 'preview-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.HELD_VACATION_WRITE,
  payload: {
    sourceRunId: 14,
    action: 'REGISTER',
    startDate: date,
    endDate: date,
    fraction: 0.5,
  },
  status: PREVIEW_STATUS.PENDING,
  previewText: '',
  expiresAt: new Date(),
  createdAt: new Date(),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  slackThreadTs: null,
  lastFailedAt: null,
  lastFailureReason: null,
  applyProgress: null,
};
const createMocks = () => {
  const repository = {
    findActiveByUser: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<LeaveUsagePrismaRepository>;
  const register = {
    execute: jest.fn().mockResolvedValue({
      result: {
        registered: {
          id: 8,
          slackUserId: 'U1',
          startDate: date,
          endDate: date,
          businessDays: 0.5,
          memo: null,
          createdAt: new Date(),
        },
        balance,
      },
    }),
  } as unknown as jest.Mocked<RegisterLeaveUsecase>;
  const cancel = {
    execute: jest
      .fn()
      .mockResolvedValue({ result: { canceledId: 8, balance } }),
  } as unknown as jest.Mocked<CancelLeaveUsecase>;
  return { repository, register, cancel };
};

describe('HeldVacationWriteApplier', () => {
  afterEach(() => jest.useRealTimers());

  it('정상 등록 카드 승인 시 요청자와 승인일로 등록하고 단계를 기록한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-25T00:00:00Z'));
    const { repository, register, cancel } = createMocks();
    const progress = {
      done: [],
      record: jest.fn().mockResolvedValue(undefined),
    };
    const result = await new HeldVacationWriteApplier(
      repository,
      register,
      cancel,
    ).apply(preview, progress);
    expect(register.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'U1',
        asOf: date,
        fraction: 0.5,
      }),
    );
    expect(progress.record).toHaveBeenCalledWith('vacation-written:8');
    expect(result.message).toContain('휴가 등록 완료');
  });

  it('같은 카드의 완료 단계가 있으면 다시 등록하지 않는다', async () => {
    const { repository, register, cancel } = createMocks();
    const result = await new HeldVacationWriteApplier(
      repository,
      register,
      cancel,
    ).apply(preview, {
      done: ['vacation-written:8'],
      record: jest.fn(),
    });
    expect(register.execute).not.toHaveBeenCalled();
    expect(result.message).toContain('이미');
  });

  it('같은 기간의 활성 기록이 있으면 다시 등록하지 않는다', async () => {
    const { repository, register, cancel } = createMocks();
    repository.findActiveByUser.mockResolvedValue([
      {
        id: 8,
        slackUserId: 'U1',
        startDate: date,
        endDate: date,
        businessDays: 0.5,
        memo: null,
        createdAt: new Date(),
      },
    ]);
    const result = await new HeldVacationWriteApplier(
      repository,
      register,
      cancel,
    ).apply(preview);
    expect(register.execute).not.toHaveBeenCalled();
    expect(result.message).toContain('이미 등록');
  });

  it('반차 여부와 무관하게 같은 기간이면 다시 등록하지 않는다', async () => {
    const { repository, register, cancel } = createMocks();
    const nextDate = { year: 2026, month: 11, day: 26 };
    repository.findActiveByUser.mockResolvedValue([
      {
        id: 8,
        slackUserId: 'U1',
        startDate: date,
        endDate: nextDate,
        businessDays: 1,
        memo: null,
        createdAt: new Date(),
      },
    ]);
    const result = await new HeldVacationWriteApplier(
      repository,
      register,
      cancel,
    ).apply({
      ...preview,
      payload: {
        sourceRunId: 14,
        action: 'REGISTER',
        startDate: date,
        endDate: nextDate,
        fraction: 0.5,
      },
    });
    expect(register.execute).not.toHaveBeenCalled();
    expect(result.message).toContain('이미 등록');
  });

  it('취소 카드 승인 시 요청자 기록을 취소하고 단계를 기록한다', async () => {
    const { repository, register, cancel } = createMocks();
    const progress = {
      done: [],
      record: jest.fn().mockResolvedValue(undefined),
    };
    const result = await new HeldVacationWriteApplier(
      repository,
      register,
      cancel,
    ).apply(
      {
        ...preview,
        payload: { sourceRunId: 14, action: 'CANCEL', usageId: 8 },
      },
      progress,
    );
    expect(cancel.execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1', usageId: 8 }),
    );
    expect(progress.record).toHaveBeenCalledWith('vacation-written:8');
    expect(result.message).toContain('취소 완료');
  });

  it('이미 취소된 기록이면 실패 카드 대신 안내로 마친다', async () => {
    const { repository, register, cancel } = createMocks();
    cancel.execute.mockRejectedValue(
      new VacationException({
        code: VacationErrorCode.USAGE_NOT_FOUND,
        message: '없음',
      }),
    );
    const result = await new HeldVacationWriteApplier(
      repository,
      register,
      cancel,
    ).apply({
      ...preview,
      payload: { sourceRunId: 14, action: 'CANCEL', usageId: 8 },
    });
    expect(result.message).toContain('이미 취소');
  });

  it('잘못된 payload는 쓰기 전에 거절한다', async () => {
    const { repository, register, cancel } = createMocks();
    await expect(
      new HeldVacationWriteApplier(repository, register, cancel).apply({
        ...preview,
        payload: {
          sourceRunId: 14,
          action: 'REGISTER',
          startDate: date,
          endDate: { year: 2026, month: 2, day: 30 },
        },
      }),
    ).rejects.toThrow();
    expect(register.execute).not.toHaveBeenCalled();
  });
});
