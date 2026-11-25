import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { RegisterScheduleUsecase } from '../application/register-schedule.usecase';
import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleStatus } from '../domain/schedule.type';
import { HeldScheduleRegisterApplier } from './held-schedule-register.applier';

const preview: PreviewAction = {
  id: 'preview-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.HELD_SCHEDULE_REGISTER,
  payload: {
    sourceRunId: 14034,
    title: '이력서 손으로 쓰기',
    dueDate: { year: 2026, month: 11, day: 25 },
  },
  status: PREVIEW_STATUS.PENDING,
  previewText: '등록할까요?',
  expiresAt: new Date('2026-11-25T01:00:00Z'),
  createdAt: new Date('2026-11-25T00:00:00Z'),
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
    findUnfinished: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<ScheduleRepositoryPort>;
  const registerSchedule = {
    execute: jest.fn().mockResolvedValue({
      id: 8,
      slackUserId: 'U1',
      title: '이력서 손으로 쓰기',
      shortTitle: null,
      shortTitleBasis: null,
      dueDate: new Date('2026-11-25T00:00:00Z'),
      createdAt: new Date('2026-11-25T00:00:00Z'),
      dueTime: null,
      linkUrl: null,
      memo: null,
      status: ScheduleStatus.OPEN,
      completedAt: null,
      isHoliday: false,
    }),
  } as unknown as jest.Mocked<RegisterScheduleUsecase>;
  return { repository, registerSchedule };
};

describe('HeldScheduleRegisterApplier', () => {
  it('잘못된 날짜 payload 면 등록 전에 거절한다', async () => {
    const { repository, registerSchedule } = createMocks();
    const applier = new HeldScheduleRegisterApplier(
      repository,
      registerSchedule,
    );
    await expect(
      applier.apply({
        ...preview,
        payload: {
          sourceRunId: 14034,
          title: '제목',
          dueDate: { year: 2026, month: 2, day: 30 },
        },
      }),
    ).rejects.toThrow();
    expect(registerSchedule.execute).not.toHaveBeenCalled();
  });

  it('정상 카드 승인 시 저장된 제목과 날짜로 등록한다', async () => {
    const { repository, registerSchedule } = createMocks();
    const progress = {
      done: [],
      record: jest.fn().mockResolvedValue(undefined),
    };
    const result = await new HeldScheduleRegisterApplier(
      repository,
      registerSchedule,
    ).apply(preview, progress);
    expect(registerSchedule.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      title: '이력서 손으로 쓰기',
      dueDate: { year: 2026, month: 11, day: 25 },
    });
    expect(result.message).toContain('등록했습니다');
    expect(progress.record).toHaveBeenCalledWith('schedule-registered:8');
  });

  it('같은 카드의 등록 완료 단계가 있으면 두 번 등록하지 않는다', async () => {
    const { repository, registerSchedule } = createMocks();
    const result = await new HeldScheduleRegisterApplier(
      repository,
      registerSchedule,
    ).apply(preview, {
      done: ['schedule-registered:8'],
      record: jest.fn(),
    });
    expect(registerSchedule.execute).not.toHaveBeenCalled();
    expect(result.message).toContain('이미 등록');
  });

  it('같은 제목과 날짜의 미완 일정이 있으면 다시 등록하지 않는다', async () => {
    const { repository, registerSchedule } = createMocks();
    repository.findUnfinished.mockResolvedValue([
      {
        title: '이력서 손으로 쓰기',
        dueDate: new Date('2026-11-25T00:00:00Z'),
      },
    ] as never);
    const result = await new HeldScheduleRegisterApplier(
      repository,
      registerSchedule,
    ).apply(preview);
    expect(registerSchedule.execute).not.toHaveBeenCalled();
    expect(result.message).toContain('이미 등록');
  });
});
