import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { RegisterScheduleUsecase } from '../../schedule/application/register-schedule.usecase';
import { ScheduleStatus } from '../../schedule/domain/schedule.type';
import {
  IdeaTriageRecord,
  IdeaTriageRepositoryPort,
} from '../domain/port/idea-triage.repository.port';
import {
  IdeaScheduleApplier,
  IdeaSchedulePayload,
} from './idea-schedule.applier';

const payload: IdeaSchedulePayload = {
  ideaTriageId: 3,
  title: '아이디어 구현',
  dueDate: { year: 2026, month: 10, day: 16 },
  memo: '원글 링크',
};

const preview: PreviewAction = {
  id: 'preview-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.IDEA_SCHEDULE,
  payload,
  status: PREVIEW_STATUS.PENDING,
  previewText: 'preview',
  expiresAt: new Date('2026-10-20T00:00:00Z'),
  createdAt: new Date('2026-10-14T00:00:00Z'),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  slackThreadTs: null,
  lastFailedAt: null,
  lastFailureReason: null,
  applyProgress: null,
};

const idea: IdeaTriageRecord = {
  id: 3,
  channelId: 'C1',
  messageTs: '1.1',
  authorSlackUserId: 'U2',
  ideaText: '아이디어',
  verdict: 'BUILD',
  reason: '이유',
  counterpoint: '반박',
  scheduleTitle: payload.title,
  effort: 'S',
  proposedDate: payload.dueDate,
  status: 'POSTED',
  replyTs: '2.2',
  previewId: 'preview-1',
  scheduleItemId: null,
  agentRunId: 1,
  createdAt: new Date('2026-10-14T00:00:00Z'),
  updatedAt: new Date('2026-10-14T00:00:00Z'),
};

const createMocks = () => {
  const repository = {
    findById: jest.fn().mockResolvedValue(idea),
    markScheduled: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IdeaTriageRepositoryPort>;
  const registerSchedule = {
    execute: jest.fn().mockResolvedValue({
      id: 8,
      slackUserId: 'U1',
      title: payload.title,
      dueDate: new Date('2026-10-16T00:00:00Z'),
      dueTime: null,
      linkUrl: null,
      memo: payload.memo,
      status: ScheduleStatus.OPEN,
      completedAt: null,
      isHoliday: false,
    }),
  } as unknown as jest.Mocked<RegisterScheduleUsecase>;
  return { repository, registerSchedule };
};

describe('IdeaScheduleApplier', () => {
  afterEach(() => jest.useRealTimers());

  it('payload 날짜가 유효하지 않으면 일정 등록 전 거절한다', async () => {
    const { repository, registerSchedule } = createMocks();
    const applier = new IdeaScheduleApplier(repository, registerSchedule);
    await expect(
      applier.apply({
        ...preview,
        payload: { ...payload, dueDate: { year: 2026, month: 2, day: 30 } },
      }),
    ).rejects.toThrow('유효한 날짜');
    expect(registerSchedule.execute).not.toHaveBeenCalled();
  });

  it('payload 제목이 40자를 초과하면 일정 등록 전 거절한다', async () => {
    const { repository, registerSchedule } = createMocks();
    const applier = new IdeaScheduleApplier(repository, registerSchedule);
    await expect(
      applier.apply({
        ...preview,
        payload: { ...payload, title: '가'.repeat(41) },
      }),
    ).rejects.toThrow('필드가 올바르지');
    expect(registerSchedule.execute).not.toHaveBeenCalled();
  });

  it('이미 등록된 일정이면 다시 생성하지 않는다', async () => {
    const { repository, registerSchedule } = createMocks();
    repository.findById.mockResolvedValue({ ...idea, scheduleItemId: 8 });
    const result = await new IdeaScheduleApplier(
      repository,
      registerSchedule,
    ).apply(preview);
    expect(result.message).toContain('이미 등록');
    expect(result.message).not.toContain('2026-10-16');
    expect(registerSchedule.execute).not.toHaveBeenCalled();
  });

  it('승인 시점에 제안일이 지났으면 KST 오늘로 당기고 원장에 id를 기록한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-18T15:30:00Z'));
    const { repository, registerSchedule } = createMocks();
    const result = await new IdeaScheduleApplier(
      repository,
      registerSchedule,
    ).apply(preview);
    expect(registerSchedule.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      title: payload.title,
      dueDate: { year: 2026, month: 10, day: 19 },
      memo: payload.memo,
    });
    expect(repository.markScheduled).toHaveBeenCalledWith(3, 8);
    expect(result.message).toContain('2026-10-19');
  });

  it('일정 등록 직후 단계 기록을 남겨, 판정 기록 갱신이 실패한 뒤 다시 승인해도 일정을 또 만들지 않는다', async () => {
    // 제안일(10-16) 당일로 고정한다 — 고정하지 않으면 그날이 지난 뒤 오늘로 당겨 등록돼 기대 날짜가 어긋난다.
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T03:00:00Z'));
    const { repository, registerSchedule } = createMocks();
    const done: string[] = [];
    const progress = {
      get done(): readonly string[] {
        return [...done];
      },
      record: jest.fn(async (step: string) => {
        done.push(step);
      }),
    };
    repository.markScheduled.mockRejectedValueOnce(new Error('DB 일시 오류'));
    const applier = new IdeaScheduleApplier(repository, registerSchedule);

    await expect(applier.apply(preview, progress)).rejects.toThrow(
      'DB 일시 오류',
    );
    await applier.apply(preview, progress);

    expect(registerSchedule.execute).toHaveBeenCalledTimes(1);
    expect(progress.record).toHaveBeenCalledWith(
      'schedule-registered:8:2026-10-16',
    );
    expect(repository.markScheduled).toHaveBeenLastCalledWith(3, 8);
  });

  it('단계 기록이 없으면(첫 승인) 일정을 등록한다', async () => {
    const { repository, registerSchedule } = createMocks();
    await new IdeaScheduleApplier(repository, registerSchedule).apply(preview, {
      done: [],
      record: jest.fn().mockResolvedValue(undefined),
    });
    expect(registerSchedule.execute).toHaveBeenCalledTimes(1);
  });

  it('첫 승인 뒤 날짜가 바뀌어 재승인해도 실제 등록한 날짜로 안내한다', async () => {
    // 첫 승인 2026-10-18 KST — 제안일(10-16)이 지나 오늘(10-18)로 당겨 등록한다.
    jest.useFakeTimers().setSystemTime(new Date('2026-10-18T03:00:00Z'));
    const { repository, registerSchedule } = createMocks();
    const done: string[] = [];
    const progress = {
      get done(): readonly string[] {
        return [...done];
      },
      record: jest.fn(async (step: string) => {
        done.push(step);
      }),
    };
    repository.markScheduled.mockRejectedValueOnce(new Error('DB 일시 오류'));
    const applier = new IdeaScheduleApplier(repository, registerSchedule);
    await expect(applier.apply(preview, progress)).rejects.toThrow(
      'DB 일시 오류',
    );

    // 재승인 2026-10-20 KST — 다시 계산하면 10-20 이 되지만 실제 등록일은 10-18 이다.
    jest.setSystemTime(new Date('2026-10-20T03:00:00Z'));
    const result = await applier.apply(preview, progress);

    expect(registerSchedule.execute).toHaveBeenCalledTimes(1);
    expect(result.message).toContain('2026-10-18');
  });
});
